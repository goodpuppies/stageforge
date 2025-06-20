import { PostalService } from "./PostalService.ts";
import type { ActorId, GenericActorFunctions, Message, TargetMessage } from "./types.ts";
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

  if (cb) {
    const messageCallback = new SignalEvent<unknown>("message-callback", 9000);

    // Modify the message type to include the UUID
    if ("type" in message) {
      // Make sure we don't add a UUID to a message that already has one
      if (!message.type.includes(":")) {
        message.type = `${message.type}:${messageCallback.id}`;
      }
    }

    worker.postMessage(message);
    return await messageCallback.wait();
  } else {
    worker.postMessage(message);
  }
}
