import { PostalService } from "./PostalService.ts";
import type { GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import {
  popTransferForPost,
  processBigInts,
  resolveActorRefsForClone,
  StandardizeAddress,
} from "./utils.ts";
import { Signal } from "./Signal.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";

// Map to store callbacks by UUID
const callbackMap = new Map<string, Signal<unknown>>();

/** Shape `runFunctions` replies with when a handler throws or is missing. */
type ActorDispatchError = {
  message: string;
  stack?: string;
  type?: string;
  event?: string;
};

export async function runFunctions(
  message: Message,
  functions: GenericActorFunctions,
  ctx: any,
) {
  if (message.payload) {
    message.payload = processBigInts(message.payload);
  }
  // Extract the base type and any callback ID
  const parts = message.type.split(":");
  const baseType = parts[0];
  const callbackId = parts.length > 1 ? parts[1] : undefined;

  // Check if this is a callback response
  if (callbackId && callbackMap.has(callbackId)) {
    // This is a callback response, trigger the stored callback
    const callback = callbackMap.get(callbackId);
    callback?.trigger(message.payload);
    callbackMap.delete(callbackId); // Clean up after use
    return;
  }

  // Report a dispatch failure back to a waiting caller instead of letting it
  // escape. An error thrown here surfaces as an unhandled rejection inside the
  // actor's worker, which tears down the whole process over one bad message.
  const failDispatch = (event: string, error: unknown, extra?: unknown) => {
    const detail = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
    LogChannel.log("actorroute", {
      event,
      baseType,
      originalType: message.type,
      from: message.address.fm,
      to: message.address.to,
      error: detail.message,
      ...(extra ?? {}),
    });
    console.error(
      `[stageforge] ${event} for "${baseType}" on ${message.address.to}: ${detail.message}`,
    );
    if (callbackId) {
      // Without this the caller waits out its whole timeout for a reply that
      // can never arrive.
      ctx.PostMessage({
        target: message.address.fm,
        type: `${baseType}:${callbackId}`,
        payload: { __actorError: { ...detail, type: baseType, event } },
      });
    }
  };

  // Check if the function exists
  if (!functions[baseType]) {
    failDispatch(
      "missing-function",
      new Error(
        `Function not found for message type: ${baseType} (original: ${message.type})`,
      ),
      { availableFunctions: Object.keys(functions) },
    );
    return;
  }
  const originalType = message.type;
  message.type = baseType;

  // Execute
  let ret: unknown;
  try {
    ret = await functions[baseType]?.(message.payload);
  } catch (error) {
    message.type = originalType;
    failDispatch("handler-failed", error);
    return;
  }

  // `cb: true` adds a callback id to the message type. Only those messages
  // should receive returned values; fire-and-forget sends must ignore returns.
  if (callbackId && ret !== undefined) {
    // Use the same format for response: baseType:callbackId
    const responseType = `${baseType}:${callbackId}`;

    try {
      ctx.PostMessage({
        target: message.address.fm,
        type: responseType,
        payload: ret,
      });
    } catch (error) {
      // A non-cloneable return value must not kill the actor either.
      message.type = originalType;
      failDispatch("response-post-failed", error);
      return;
    }
  }

  // Restore the original message type
  message.type = originalType;
}

export async function PostMessage(
  message: TargetMessage | Message,
  cb?: boolean,
  ctx?: any,
): Promise<unknown | void> {
  if ("target" in message && Array.isArray(message.target)) {
    if (cb) {
      throw new Error("Cannot use callback with multiple targets");
    }
    if (
      "transfer" in message &&
      (message as { transfer?: unknown }).transfer != null
    ) {
      const t = (message as { transfer?: Transferable[] }).transfer;
      if (Array.isArray(t) && t.length > 0) {
        throw new Error(
          "PostMessage: transfer is not supported with multiple targets",
        );
      }
    }

    const promises = message.target.map((target) => {
      const singleMessage = { ...message, target };
      return PostMessage(singleMessage, false, ctx);
    });

    return Promise.all(promises);
  }

  message = StandardizeAddress(message, ctx);

  if (Array.isArray(message.address.to)) {
    throw new Error(
      "PostMessage in shared.ts should not receive array addresses. Use the PostalService.PostMessage method for that.",
    );
  }

  let worker;
  if (!ctx.worker) {
    const actor = PostalService.actors.get(message.address.to);
    if (!actor) {
      console.error("Actor not found: ", message);
      throw new Error(`Actor not found: ${message.address.to}`);
    }
    worker = actor.worker;
  } else {
    worker = ctx.worker;
  }

  message = resolveActorRefsForClone(message);

  const transfer = popTransferForPost(message as Record<string, unknown>);

  if (cb) {
    // Generate a UUID for this callback
    const callbackId = crypto.randomUUID();

    // Create a new signal for this callback
    const messageCallback = new Signal<unknown>();

    // Store the callback in the map with the UUID as key
    callbackMap.set(callbackId, messageCallback);

    // Modify the message type to include the UUID
    if ("type" in message) {
      // Make sure we don't add a UUID to a message that already has one
      if (!message.type.includes(":")) {
        message.type = `${message.type}:${callbackId}`;
      }
    }

    worker.postMessage(message, transfer ?? []);
    LogChannel.log("actorroute", {
      event: "post-callback",
      type: message.type,
      from: message.address.fm,
      to: message.address.to,
    });
    try {
      const response = await messageCallback.wait();
      // A dispatch failure travels back as data so the actor's worker survives,
      // but an awaiting caller must still see it as a failure — otherwise the
      // error object flows onward as if it were a real return value.
      const failure = (response as { __actorError?: ActorDispatchError } | null)
        ?.__actorError;
      if (failure != null) {
        const error = new Error(
          `${message.address.to} failed handling "${failure.type ?? "message"}": ${failure.message}`,
        );
        if (failure.stack) error.stack = failure.stack;
        throw error;
      }
      return response;
    } finally {
      callbackMap.delete(callbackId);
    }
  } else {
    LogChannel.log("actorroute", {
      event: "post",
      type: message.type,
      from: message.address.fm,
      to: message.address.to,
    });
    worker.postMessage(message, transfer ?? []);
  }
}
