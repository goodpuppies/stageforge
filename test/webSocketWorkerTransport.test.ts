import { WebSocketWorker } from "../src/lib/WebSocketWorker.ts";
import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
  type WebSocketWorkerWireMessage,
} from "../src/lib/webSocketWorkerCodec.ts";

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${milliseconds}ms`)),
        milliseconds,
      )
    ),
  ]);
}

Deno.test("WebSocketWorker operates independently over an existing socket", async () => {
  let port = 0;
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      onListen: (address) => {
        port = address.port;
      },
    },
    (request) => {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () =>
        socket.send(encodeWebSocketWorkerMessage({ kind: "ready" }));
      socket.onmessage = (event) => {
        const message = decodeWebSocketWorkerMessage(
          String(event.data),
        ) as WebSocketWorkerWireMessage;
        if (message.kind === "message") {
          socket.send(encodeWebSocketWorkerMessage(message));
        } else if (message.kind === "terminate") {
          socket.close(1000, "terminated");
        }
      };
      return response;
    },
  );

  const worker = new WebSocketWorker(
    new WebSocket(`ws://127.0.0.1:${port}/worker`),
  );
  const received = new Promise<unknown>((resolve) => {
    worker.onmessage = (event) => resolve(event.data);
  });
  worker.postMessage({ label: "standalone", count: 7n });

  const result = await timeout(received, 5_000) as {
    label: string;
    count: bigint;
  };
  if (result.label !== "standalone" || result.count !== 7n) {
    throw new Error("WebSocketWorker did not preserve its message payload");
  }

  worker.terminate();
  await server.shutdown();
});
