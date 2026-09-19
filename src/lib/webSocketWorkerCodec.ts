const BIGINT_TAG = "__websocket_worker_bigint__";

/** JSON wire format used by the process-backed Worker transport. */
export function encodeWebSocketWorkerMessage(value: unknown): string {
  const encoded = JSON.stringify(
    value,
    (_key, item) =>
      typeof item === "bigint" ? { [BIGINT_TAG]: item.toString() } : item,
  );
  if (encoded == null) {
    throw new DOMException(
      "Worker message is not serializable",
      "DataCloneError",
    );
  }
  return encoded;
}

export function decodeWebSocketWorkerMessage(text: string): unknown {
  return JSON.parse(text, (_key, item) => {
    if (
      item != null && typeof item === "object" &&
      Object.keys(item).length === 1 && BIGINT_TAG in item &&
      typeof item[BIGINT_TAG] === "string"
    ) {
      return BigInt(item[BIGINT_TAG]);
    }
    return item;
  });
}

export type WebSocketWorkerWireMessage =
  | { kind: "ready" }
  | { kind: "message"; data: unknown }
  | { kind: "messageerror"; message: string }
  | { kind: "error"; message: string; stack?: string }
  | { kind: "terminate" };
