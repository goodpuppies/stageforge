import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
  type WebSocketWorkerWireMessage,
} from "./webSocketWorkerCodec.ts";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = Deno.args.find((entry) => entry.startsWith(prefix))?.slice(
    prefix.length,
  );
  if (!value) throw new Error(`Missing ${prefix}<value>`);
  return value;
}

const socketUrl = argument("socket");
const scriptUrl = argument("script");
const workerName = argument("name");
const socket = new WebSocket(socketUrl);
const worker = new Worker(scriptUrl, { name: workerName, type: "module" });
const outgoing: string[] = [];
let closing = false;

function send(message: WebSocketWorkerWireMessage): void {
  const encoded = encodeWebSocketWorkerMessage(message);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encoded);
  } else if (!closing) {
    outgoing.push(encoded);
  }
}

worker.onmessage = (event) => send({ kind: "message", data: event.data });
worker.onmessageerror = () =>
  send({
    kind: "messageerror",
    message: "Actor worker could not deserialize a message",
  });
worker.onerror = (event) => {
  event.preventDefault();
  send({
    kind: "error",
    message: event.message || "Actor worker failed",
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
};

socket.onopen = () => {
  send({ kind: "ready" });
  for (const message of outgoing.splice(0)) socket.send(message);
};

socket.onmessage = (event) => {
  try {
    if (typeof event.data !== "string") {
      throw new Error("WebSocketWorker only accepts text frames");
    }
    const message = decodeWebSocketWorkerMessage(
      event.data,
    ) as WebSocketWorkerWireMessage;
    if (message.kind === "message") {
      worker.postMessage(message.data);
      return;
    }
    if (message.kind === "terminate") {
      closing = true;
      worker.terminate();
      socket.close(1000, "terminated");
    }
  } catch (error) {
    send({
      kind: "messageerror",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

socket.onerror = () => {
  if (!closing) {
    console.error("[WebSocketWorkerHost] WebSocket transport failed");
  }
};

socket.onclose = () => {
  worker.terminate();
  Deno.exit(closing ? 0 : 1);
};
