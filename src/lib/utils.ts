import {
  type AddressedMessage,
  type Message,
  type MessageType,
  System,
  type TargetMessage,
} from "./types.ts";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function StandardizeAddress(
  message: TargetMessage | Message,
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
    delete (addressedMessage as any).target;
  } else {
    addressedMessage = message;
  }
  return addressedMessage;
}

export function processBigInts(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === "object") {
    if (data !== null && "__bigint__" in data) {
      return BigInt(data.__bigint__);
    }

    if (Array.isArray(data)) {
      return data.map((item) => processBigInts(item));
    }

    const result: Record<string, any> = {};
    for (const key in data) {
      result[key] = processBigInts(data[key]);
    }
    return result;
  }

  return data;
}
