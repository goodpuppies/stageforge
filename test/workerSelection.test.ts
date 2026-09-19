import {
  PostalService,
  type WorkerConstructor,
} from "../src/lib/PostalService.ts";
import { createActorId, System } from "../src/lib/types.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class TestWorker extends EventTarget implements Worker {
  static instances: TestWorker[] = [];

  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  readonly scriptUrl: string;
  terminated = false;

  constructor(scriptUrl: string | URL, _options?: WorkerOptions) {
    super();
    this.scriptUrl = String(scriptUrl);
    TestWorker.instances.push(this);
  }

  postMessage(
    message: unknown,
    _transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ): void {
    const init = message as {
      type?: string;
      payload?: { actorId?: string; callbackKey?: string };
    };
    if (init.type !== "INIT") return;
    const actorId = createActorId(
      init.payload?.actorId ?? `test@${crypto.randomUUID()}`,
    );
    queueMicrotask(() => {
      this.onmessage?.call(
        this,
        new MessageEvent("message", {
          data: {
            address: { fm: actorId, to: System },
            type: "LOADED",
            payload: {
              actorId,
              callbackKey: init.payload?.callbackKey ?? "",
            },
          },
        }),
      );
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

class DefaultTestWorker extends TestWorker {
  static override instances: DefaultTestWorker[] = [];

  constructor(scriptUrl: string | URL, options?: WorkerOptions) {
    super(scriptUrl, options);
    DefaultTestWorker.instances.push(this);
  }
}

class ProcessTestWorker extends TestWorker {
  static override instances: ProcessTestWorker[] = [];

  constructor(scriptUrl: string | URL, options?: WorkerOptions) {
    super(scriptUrl, options);
    ProcessTestWorker.instances.push(this);
  }
}

Deno.test("PostalService selects a registered worker for one actor", async () => {
  PostalService.actors.clear();
  DefaultTestWorker.instances.length = 0;
  ProcessTestWorker.instances.length = 0;
  const postal = new PostalService(DefaultTestWorker as WorkerConstructor);
  postal.registerWorker("process", ProcessTestWorker as WorkerConstructor);

  const localId = createActorId(`local@${crypto.randomUUID()}`);
  const processId = createActorId(`process@${crypto.randomUUID()}`);
  await postal.add("./local.ts", import.meta.url, localId);
  await postal.add("./process.ts", import.meta.url, processId, "process");

  assert(
    DefaultTestWorker.instances.length === 1,
    "default actor should use the default worker",
  );
  assert(
    ProcessTestWorker.instances.length === 1,
    "selected actor should use the registered worker",
  );
  assert(
    PostalService.actors.get(processId)?.workerKind === "process",
    "actor metadata should retain its worker kind",
  );
  PostalService.actors.clear();
});

Deno.test("PostalService rejects an unknown worker kind before creating a worker", async () => {
  PostalService.actors.clear();
  const postal = new PostalService(DefaultTestWorker as WorkerConstructor);
  let error: unknown;
  try {
    await postal.add("./unknown.ts", import.meta.url, undefined, "missing");
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof Error,
    "unknown worker kind should reject actor creation",
  );
  assert(
    error.message === "Unknown worker kind: missing",
    "error should identify the missing worker kind",
  );
});
