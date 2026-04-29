import { PostalService } from "./PostalService.ts";
import type { ActorClient, ActorId, GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import { processBigInts, StandardizeAddress } from "./utils.ts";
import { SignalEvent } from "./Signal.ts";
import { assert } from "@goodpuppies/logicalassert";

export async function runFunctions(
  message: Message,
  functions: GenericActorFunctions,
  // deno-lint-ignore no-explicit-any
  ctx: any,
) {
  if (message.payload) {
    message.payload = processBigInts(message.payload);
  }
  // Extract the base type and any callback ID
  const parts = message.type.split(":");
  const baseType = parts[0];
  const callbackId = parts.length > 1 ? parts[1] : undefined;

  // If there's a callback ID AND no function for the base type, it's a response.
  if (callbackId && !functions[baseType]) {
    SignalEvent.trigger(callbackId, message.payload);
    return;
  }

  // Check if the function exists
  if (!functions[baseType]) {
    throw new Error(
      `Function not found for message type: ${baseType} (original: ${message.type})`,
    );
  }
  const originalType = message.type;
  message.type = baseType;

  // Execute
  const ret = await functions[baseType]?.(message.payload, ctx);

  // If the function returned a value and we have a callback ID, send a response
  if (ret !== undefined) {
    // Use the same format for response: baseType:callbackId
    const responseType = callbackId ? `${baseType}:${callbackId}` : baseType;

    ctx.PostMessage({
      target: message.address.fm,
      type: responseType,
      payload: ret,
    });
  }

  // Restore the original message type
  message.type = originalType;
}

export async function PostMessage(
  message: TargetMessage | Message,
  cb?: boolean,
  // deno-lint-ignore no-explicit-any
  ctx?: any,
): Promise<unknown | void> {
  if ("target" in message && Array.isArray(message.target)) {
    if (message.transfer?.length) {
      throw new Error("Cannot use transfer with multiple targets");
    }

    if (cb) {
      throw new Error("Cannot use callback with multiple targets");
    }

    const promises = message.target.map((target) => {
      const singleMessage = { ...message, target };
      return PostMessage(singleMessage, false, ctx);
    });

    return Promise.all(promises);
  }

  if (!message.payload) {
    message.payload = null;
  }

  message = StandardizeAddress(message, ctx);

  if (Array.isArray(message.address.to)) {
    throw new Error(
      "PostMessage in shared.ts should not receive array addresses. Use the PostalService.PostMessage method for that.",
    );
  }

  const worker = assert(!ctx.worker).with({
    true: () => {
      const actor = PostalService.actors.get(message.address.to as ActorId);
      if (!actor) {
        console.error("Actor not found: ", message);
        throw new Error(`Actor not found: ${message.address.to}`);
      }
      return actor.worker;
    },
    unknown: () => {
      return ctx.worker;
    },
  });

  const transfer = message.transfer ?? [];
  delete message.transfer;

  if (cb) {
    const messageCallback = new SignalEvent<unknown>("message-callback", 9000);

    // Modify the message type to include the UUID
    if ("type" in message) {
      // Make sure we don't add a UUID to a message that already has one
      if (!message.type.includes(":")) {
        message.type = `${message.type}:${messageCallback.id}`;
      }
    }

    worker.postMessage(message, transfer);
    return await messageCallback.wait();
  } else {
    worker.postMessage(message, transfer);
  }
}

class DeferredActorResult<T> implements PromiseLike<T> {
  private promise?: Promise<T | void>;
  private readonly fireAndForgetTimer: number;

  constructor(
    private readonly message: TargetMessage,
    // deno-lint-ignore no-explicit-any
    private readonly ctx: any,
  ) {
    this.fireAndForgetTimer = setTimeout(() => this.send(false), 0);
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    clearTimeout(this.fireAndForgetTimer);
    return this.send(true).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    clearTimeout(this.fireAndForgetTimer);
    return this.send(true).catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    clearTimeout(this.fireAndForgetTimer);
    return this.send(true).finally(onfinally);
  }

  private send(callback: true): Promise<T>;
  private send(callback: false): Promise<void>;
  private send(callback: boolean): Promise<T | void> {
    if (this.promise) {
      return this.promise;
    }

    this.promise = PostMessage({ ...this.message }, callback, this.ctx) as Promise<T | void>;
    return this.promise;
  }
}

export function createActorClient<T extends GenericActorFunctions>(
  target: ActorId,
  // deno-lint-ignore no-explicit-any
  ctx: any,
): ActorClient<T> {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "id") {
        return target;
      }

      if (property === "then" || property === "catch" || property === "finally") {
        return undefined;
      }

      if (typeof property !== "string") {
        return undefined;
      }

      return (payload?: unknown) =>
        new DeferredActorResult({
          target,
          type: property,
          payload: payload ?? null,
        }, ctx);
    },
  }) as ActorClient<T>;
}
