import { PostalService } from "./PostalService.ts";
import type { GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import { processBigInts, StandardizeAddress } from "./utils.ts";
import { Signal } from "./Signal.ts";


// Map to store callbacks by UUID
const callbackMap = new Map<string, Signal<unknown>>();

export async function runFunctions(message: Message, functions: GenericActorFunctions, ctx: any) {
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

  // Check if the function exists
  if (!functions[baseType]) {
    throw new Error(`Function not found for message type: ${baseType} (original: ${message.type})`);
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
      payload: ret
    });
  }

  // Restore the original message type
  message.type = originalType;
}

export async function PostMessage(
  message: TargetMessage | Message,
  cb?: boolean,
  ctx?: any
): Promise<unknown | void> {
  if ('target' in message && Array.isArray(message.target)) {
    if (cb) {
      throw new Error("Cannot use callback with multiple targets");
    }
    
    const promises = message.target.map(target => {
      const singleMessage = { ...message, target };
      return PostMessage(singleMessage, false, ctx);
    });
    
    return Promise.all(promises);
  }

  message = StandardizeAddress(message, ctx);

  if (Array.isArray(message.address.to)) {
    throw new Error("PostMessage in shared.ts should not receive array addresses. Use the PostalService.PostMessage method for that.");
  }

  let worker;
  if (!ctx.worker) {
    const actor = PostalService.actors.get(message.address.to);
    if (!actor) {
      console.error("Actor not found: ",message)
      throw new Error(`Actor not found: ${message.address.to}`);
    }
    worker = actor.worker;
  }
  else {
    worker = ctx.worker;
  }

  if (cb) {
    // Generate a UUID for this callback
    const callbackId = crypto.randomUUID();
    
    // Create a new signal for this callback
    const messageCallback = new Signal<unknown>();
    
    // Store the callback in the map with the UUID as key
    callbackMap.set(callbackId, messageCallback);
    
    // Modify the message type to include the UUID
    if ('type' in message) {
      // Make sure we don't add a UUID to a message that already has one
      if (!message.type.includes(':')) {
        message.type = `${message.type}:${callbackId}`;
      }
    }
    
    worker.postMessage(message);
    try {
      return await messageCallback.wait();
    } finally {
      callbackMap.delete(callbackId);
    }
  }
  else {
    worker.postMessage(message);
  }
}