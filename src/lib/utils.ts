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

/**
 * Revives `{ __bigint__: "<digits>" }` markers (JSON transports) into BigInts.
 *
 * Copy-on-write: a payload without markers, which is nearly every message, comes back as the same
 * object, so per-frame payloads are walked but never re-allocated.
 */
export function processBigInts(data: any): any {
  if (data === null || typeof data !== 'object') {
    return data;
  }
  // Typed arrays / buffers / DataView must not be walked (indices → plain objects).
  if (
    data instanceof ArrayBuffer || data instanceof SharedArrayBuffer ||
    ArrayBuffer.isView(data)
  ) {
    return data;
  }
  if ('__bigint__' in data) {
    return BigInt(data.__bigint__);
  }

  if (Array.isArray(data)) {
    let copy: any[] | null = null;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const next = processBigInts(item);
      if (next !== item) {
        copy ??= data.slice();
        copy[i] = next;
      }
    }
    return copy ?? data;
  }

  let copy: Record<string, any> | null = null;
  for (const key in data) {
    const value = data[key];
    const next = processBigInts(value);
    if (next !== value) {
      copy ??= { ...data };
      copy[key] = next;
    }
  }
  return copy ?? data;
}
