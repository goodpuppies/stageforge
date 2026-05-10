import {
  ActorIdValue,
  System,
  type Message,
  type TargetMessage,
  type AddressedMessage,
  type ActorRefBase,
  type MessageType
} from "./types.ts";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function StandardizeAddress(message: TargetMessage | Message, ctx: any): AddressedMessage<MessageType> {
  let from
  if (ctx.state) { from = ctx.state.id }
  else { from = System }

  let addressedMessage: AddressedMessage<MessageType>;

  if ('target' in message) {
    addressedMessage = {
      address: { fm: from, to: message.target },
      ...message,
    };
    delete (addressedMessage as any).target;
  } else {
    addressedMessage = message;
  }
  return addressedMessage
}

/**
 * Removes `transfer` from a message object and returns it for the second argument to
 * `worker.postMessage`. The property must not be structured-cloned on the wire.
 */
export function popTransferForPost(message: Record<string, unknown>): Transferable[] | undefined {
  const t = message.transfer;
  delete message.transfer;
  if (t === undefined || t === null) {
    return undefined;
  }
  if (!Array.isArray(t)) {
    throw new Error("PostMessage: transfer must be an array of Transferable objects");
  }
  if (t.length === 0) {
    return undefined;
  }
  return t as Transferable[];
}

export function resolveActorRefsForClone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (ActorIdValue in value) {
    return ((value as unknown as ActorRefBase)[ActorIdValue]) as T;
  }
  if (
    value instanceof ArrayBuffer ||
    value instanceof SharedArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveActorRefsForClone(item)) as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    result[key] = resolveActorRefsForClone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

export function processBigInts(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === 'object') {
    if (data !== null && '__bigint__' in data) {
      return BigInt(data.__bigint__);
    }

    if (Array.isArray(data)) {
      return data.map(item => processBigInts(item));
    }

    // `for...in` on SharedArrayBuffer / ArrayBuffer yields nothing → was becoming `{}`.
    // Typed arrays must not be walked (indices → plain objects); same for DataView.
    if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
      return data;
    }
    if (ArrayBuffer.isView(data)) {
      return data;
    }

    const result: Record<string, any> = {};
    for (const key in data) {
      result[key] = processBigInts(data[key]);
    }
    return result;
  }

  return data;
}
