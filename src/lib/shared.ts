import { PostalService } from "./PostalService.ts";
import type { GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import { Signal, StandardizeAddress } from "./utils.ts";

// Map to store callbacks by UUID
const callbackMap = new Map<string, Signal<unknown>>();

export async function runFunctions(message: Message, functions: GenericActorFunctions, ctx: any) {
  // Check if this is a callback message
  if (message.type.startsWith("CB:")) {
    // Extract the UUID from the callback message type
    const parts = message.type.split(":");
    const callbackId = parts.length > 2 ? parts[2] : undefined;
    
    // If we have a UUID, try to find the corresponding callback
    if (callbackId && callbackMap.has(callbackId)) {
      const callback = callbackMap.get(callbackId);
      callback?.trigger(message.payload);
      callbackMap.delete(callbackId); // Clean up after use
      return;
    } else {
      // If no UUID or no callback found, it's an error
      console.error("fullmsg: ", message);
      throw new Error(`Callback received without a receiver: ${message.type}`);
    }
  } else {
    // Check if the message type contains a UUID
    const parts = message.type.split(":");
    let baseType = message.type;
    let callbackId: string | undefined;
    
    // If the message type has a UUID part, extract it
    if (parts.length > 1) {
      baseType = parts[0];
      callbackId = parts[1];
    }
    
    // Check if the function exists
    if (!functions[baseType]) {
      throw new Error(`Function not found for message type: ${baseType} (original: ${message.type})`);
    }
    
    // Store the original message type for later use
    const originalType = message.type;
    
    // Set the message type to the base type for function execution
    message.type = baseType;
    
    // Execute the function
    const ret = await functions[baseType]?.(message.payload);
    
    if (ret && baseType !== "CB") {
      // If we have a callbackId, use it in the response
      const cbType = callbackId ? `CB:${baseType}:${callbackId}` : `CB:${baseType}`;
      
      ctx.PostMessage({
        target: message.address.fm,
        type: cbType,
        payload: ret
      });
    }
    
    // Restore the original message type
    message.type = originalType;
  }
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
    const actor = PostalService.actors.get(message.address.to as string);
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