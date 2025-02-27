import { PostalService } from "./PostalService.ts";
import { GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import { Signal, StandardizeAddress } from "./utils.ts";

export async function runFunctions(message: Message, functions: GenericActorFunctions, ctx: any) {
  if (message.type.startsWith("CB:") && !ctx.callback) {
    throw new Error(`Callback received without a receiver: ${message.type}`);
  }
  if (message.type.startsWith("CB:")) { message.type = "CB"; }

  const ret = await (functions[message.type])?.(message.payload);
  
  if (ret && message.type !== "CB") {
    ctx.PostMessage({
      target: message.address.fm,
      type: `CB:${message.type}`,
      payload: ret
    });
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

  message = StandardizeAddress(message, ctx)

  if (Array.isArray(message.address.to)) {
    throw new Error("PostMessage in shared.ts should not receive array addresses. Use the PostalService.PostMessage method for that.");
  }

  let worker
  if (!ctx.worker) {
    const actor = PostalService.actors.get(message.address.to as string);
    if (!actor) {
      throw new Error(`Actor not found: ${message.address.to}`);
    }
    worker = actor.worker;
  }
  else {
    worker = ctx.worker
  }

  if (cb) {
    const messageCallback = new Signal<unknown>();
    ctx.callback = messageCallback;
    worker.postMessage(message);
    try {
      return await messageCallback.wait();
    } finally {
      if (ctx.callback === messageCallback) {
        ctx.callback = null;
      }
    }
  }
  else {
    worker.postMessage(message);
  }
}