import { type AddressedMessage, type Message, type MessageType, System, type TargetMessage } from "./types.ts";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function StandardizeAddress(
  message: TargetMessage | Message,
  // deno-lint-ignore no-explicit-any
  ctx: any,
): AddressedMessage<MessageType> {
  let from;
  if (ctx.state) from = ctx.state.id;
  else from = System;

  let addressedMessage: AddressedMessage<MessageType>;

  if ("target" in message) {
    addressedMessage = {
      address: { fm: from, to: message.target },
      ...message,
    };
    // deno-lint-ignore no-explicit-any
    delete (addressedMessage as any).target;
  } else {
    addressedMessage = message;
  }
  return addressedMessage;
}

export function processBigInts<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === "object") {
    // deno-lint-ignore no-explicit-any
    if (data !== null && typeof (data as any).__bigint__ === "string") {
      // deno-lint-ignore no-explicit-any
      return BigInt((data as any).__bigint__) as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => processBigInts(item)) as unknown as T;
    }

    const result: Record<string, unknown> = {};
    for (const key in data as Record<string, unknown>) {
      result[key] = processBigInts((data as Record<string, unknown>)[key]);
    }
    return result as T;
  }

  return data;
}
