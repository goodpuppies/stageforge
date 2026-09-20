import { WebSocketWorker } from "./WebSocketWorker.ts";

const WEBSOCKET_HOST_MODULE = new URL(
  "./WebSocketWorkerHost.ts",
  import.meta.url,
);

export interface IPCWorkerTransport {
  worker: Worker;
  hostModule: string | URL;
  hostArguments: string[];
  close(): void | Promise<void>;
}

export type IPCWorkerTransportFactory = () => IPCWorkerTransport;

export interface IPCWorkerOptions extends WorkerOptions {
  /** Defaults to the private loopback WebSocket transport. */
  transportFactory?: IPCWorkerTransportFactory;
}

/** Builds the argv that launches a child process running `scriptUrl` with `args`. */
export type WorkerChildArgs = (scriptUrl: URL, args: readonly string[]) => string[];

let workerChildArgs: WorkerChildArgs = defaultWorkerChildArgs;

/**
 * Installs how `{ worker: "process" }` children are launched.
 *
 * A checkout runs the host module through the Deno CLI. A compiled build has none — `deno compile`
 * embeds `denort`, which ships no subcommands — so the binary has to be told how to dispatch
 * itself; PetPlay passes its own launcher at boot.
 */
export function setWorkerChildArgs(launcher: WorkerChildArgs): void {
  workerChildArgs = launcher;
}

function defaultWorkerChildArgs(
  scriptUrl: URL,
  args: readonly string[],
): string[] {
  if (Deno.build.standalone) {
    throw new Error(
      "IPCWorker has no child launcher in a compiled build; call setWorkerChildArgs first",
    );
  }
  const commandArgs = ["run", "-A", "--unstable-webgpu", "--no-check"];
  const configPath = `${Deno.cwd().replace(/\/$/, "")}/deno.json`;
  try {
    Deno.statSync(configPath);
    commandArgs.push(`--config=${configPath}`);
  } catch {
    // Deno can resolve the child without an explicit project config.
  }
  commandArgs.push(scriptUrl.href, ...args);
  return commandArgs;
}

function createWebSocketTransport(): IPCWorkerTransport {
  const token = crypto.randomUUID();
  let resolveSocket!: (socket: WebSocket) => void;
  let rejectSocket!: (error: unknown) => void;
  const socket = new Promise<WebSocket>((resolve, reject) => {
    resolveSocket = resolve;
    rejectSocket = reject;
  });
  let accepted = false;
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
      const url = new URL(request.url);
      if (
        url.pathname !== "/worker" || url.searchParams.get("token") !== token
      ) {
        return new Response("Not found", { status: 404 });
      }
      if (accepted) {
        return new Response("Worker transport already connected", {
          status: 409,
        });
      }
      accepted = true;
      try {
        const { socket, response } = Deno.upgradeWebSocket(request);
        resolveSocket(socket);
        return response;
      } catch (error) {
        rejectSocket(error);
        throw error;
      }
    },
  );
  server.unref();

  return {
    worker: new WebSocketWorker(socket),
    hostModule: WEBSOCKET_HOST_MODULE,
    hostArguments: [
      `--socket=ws://127.0.0.1:${port}/worker?token=${token}`,
    ],
    close: () => server.shutdown().catch(() => undefined),
  };
}

/**
 * Worker-compatible actor hosted in a separate Deno process.
 *
 * Process lifecycle is independent from the selected duplex transport.
 */
export class IPCWorker extends EventTarget implements Worker {
  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;

  readonly finished: Promise<Deno.CommandStatus>;

  private readonly transport: IPCWorkerTransport;
  private readonly child: Deno.ChildProcess;
  private terminated = false;
  private fallbackKillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scriptUrl: string | URL, options?: IPCWorkerOptions) {
    super();
    this.transport = (options?.transportFactory ?? createWebSocketTransport)();
    this.attachTransport(this.transport.worker);

    this.child = new Deno.Command(Deno.execPath(), {
      args: workerChildArgs(new URL(this.transport.hostModule, import.meta.url), [
        ...this.transport.hostArguments,
        // An absolute URL once the caller resolved it against `import.meta.url` (a checkout path, or
        // the dispatcher's snapshot href); resolved against the cwd for a bare relative script name.
        `--script=${new URL(scriptUrl, `file://${Deno.cwd()}/`).href}`,
        `--name=${options?.name ?? String(scriptUrl)}`,
      ]),
      cwd: Deno.cwd(),
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    this.finished = this.child.status;
    void this.finished.then((status) => this.handleChildExit(status));
  }

  postMessage(
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ): void {
    this.transport.worker.postMessage(
      message,
      transferOrOptions as Transferable[],
    );
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.transport.worker.terminate();
    void this.transport.close();
    this.fallbackKillTimer = setTimeout(() => {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // The process already exited.
      }
    }, 2_000);
  }

  private attachTransport(worker: Worker): void {
    worker.onmessage = (event) => {
      const forwarded = new MessageEvent("message", { data: event.data });
      this.onmessage?.call(this, forwarded);
      this.dispatchEvent(forwarded);
    };
    worker.onmessageerror = (event) => {
      const forwarded = new MessageEvent("messageerror", { data: event.data });
      this.onmessageerror?.call(this, forwarded);
      this.dispatchEvent(forwarded);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      const forwarded = new ErrorEvent("error", {
        error: event.error,
        message: event.message,
      });
      this.onerror?.call(this, forwarded);
      this.dispatchEvent(forwarded);
    };
  }

  private handleChildExit(status: Deno.CommandStatus): void {
    if (this.fallbackKillTimer != null) clearTimeout(this.fallbackKillTimer);
    this.fallbackKillTimer = null;
    void this.transport.close();
    if (!this.terminated && !status.success) {
      const error = new Error(
        `IPCWorker child exited with code ${status.code}${
          status.signal ? ` (${status.signal})` : ""
        }`,
      );
      const event = new ErrorEvent("error", {
        error,
        message: error.message,
      });
      this.onerror?.call(this, event);
      this.dispatchEvent(event);
    }
  }
}
