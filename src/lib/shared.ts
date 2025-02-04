import { PostalService } from "./PostalService.ts";
import { GenericActorFunctions, Message, TargetMessage } from "./types.ts";
import { Signal, StandardizeAddress } from "./utils.ts";

export async function runFunctions(message: Message, functions: GenericActorFunctions, ctx: any) {
  if (message.type.startsWith("CB:") && !ctx.callback) {
    throw new Error(`Callback received without a receiver: ${message.type}`);
  }
  if (message.type.startsWith("CB:")) { message.type = "CB"; }

  const ret = await (functions[message.type])?.(message.payload);
  if (ret) {
    ctx.PostMessage({
      target: message.address.fm,
      type: `CB:${message.type}`,
      payload: ret
    })
  }
}

export async function PostMessage(
  message: TargetMessage | Message,
  cb?: boolean,
  ctx?: any
): Promise<unknown | void> {
  message = StandardizeAddress(message, ctx)

  let worker
  if (!ctx.worker) {
    worker = PostalService.actors.get(message.address.to as string)!;
  }
  else {
    worker = ctx.worker
  }

  if (cb) {
    ctx.callback = new Signal<unknown>();
    worker.postMessage(message);
    const result = await ctx.callback.wait();
    return result;
  }
  else {
    worker.postMessage(message);
  }
}