import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
  type WebSocketWorkerWireMessage,
} from "./webSocketWorkerCodec.ts";

function transferList(
  transferOrOptions?: Transferable[] | StructuredSerializeOptions,
): Transferable[] {
  if (Array.isArray(transferOrOptions)) return transferOrOptions;
  return transferOrOptions?.transfer ?? [];
}

/** Worker-compatible messaging over an existing WebSocket connection. */
export class WebSocketWorker extends EventTarget implements Worker {
  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;

  private socket: WebSocket | null = null;
  private readonly queue: string[] = [];
  private ready = false;
  private terminated = false;

  constructor(socket: WebSocket | Promise<WebSocket>) {
    super();
    void Promise.resolve(socket).then(
      (connectedSocket) => this.attachSocket(connectedSocket),
      (error) =>
        this.emitError(
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
  }

  postMessage(
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ): void {
    if (this.terminated) {
      throw new DOMException("Worker has been terminated", "InvalidStateError");
    }
    if (transferList(transferOrOptions).length > 0) {
      throw new DOMException(
        "Transferable objects are not supported across WebSocketWorker boundaries",
        "DataCloneError",
      );
    }
    let encoded: string;
    try {
      encoded = encodeWebSocketWorkerMessage({
        kind: "message",
        data: message,
      });
    } catch (error) {
      throw error instanceof DOMException
        ? error
        : new DOMException(String(error), "DataCloneError");
    }
    if (this.socket?.readyState === WebSocket.OPEN && this.ready) {
      this.socket.send(encoded);
    } else {
      this.queue.push(encoded);
    }
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.queue.length = 0;
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(encodeWebSocketWorkerMessage({ kind: "terminate" }));
      } catch {
        this.socket.close();
      }
    } else {
      this.socket?.close();
    }
  }

  private attachSocket(socket: WebSocket): void {
    if (this.terminated) {
      socket.close(1000, "terminated");
      return;
    }
    this.socket = socket;
    socket.onmessage = (event) => this.handleSocketMessage(event);
    socket.onerror = () => {
      if (!this.terminated) {
        this.emitError(new Error("WebSocketWorker transport failed"));
      }
    };
    socket.onclose = () => {
      this.ready = false;
      this.socket = null;
    };
  }

  private handleSocketMessage(event: MessageEvent): void {
    try {
      if (typeof event.data !== "string") {
        throw new Error("WebSocketWorker only accepts text frames");
      }
      const message = decodeWebSocketWorkerMessage(
        event.data,
      ) as WebSocketWorkerWireMessage;
      switch (message.kind) {
        case "ready":
          this.ready = true;
          for (const queued of this.queue.splice(0)) this.socket?.send(queued);
          break;
        case "message":
          this.emitMessage(message.data);
          break;
        case "messageerror":
          this.emitMessageError(message.message);
          break;
        case "error":
          this.emitError(
            Object.assign(new Error(message.message), { stack: message.stack }),
          );
          break;
      }
    } catch (error) {
      this.emitMessageError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private emitMessage(data: unknown): void {
    const event = new MessageEvent("message", { data });
    this.onmessage?.call(this, event);
    this.dispatchEvent(event);
  }

  private emitMessageError(message: string): void {
    const event = new MessageEvent("messageerror", { data: message });
    this.onmessageerror?.call(this, event);
    this.dispatchEvent(event);
  }

  private emitError(error: Error): void {
    const event = new ErrorEvent("error", { error, message: error.message });
    this.onerror?.call(this, event);
    this.dispatchEvent(event);
  }
}
