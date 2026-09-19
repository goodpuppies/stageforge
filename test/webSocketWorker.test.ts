import { PostalService } from "../src/lib/PostalService.ts";
import { IPCWorker } from "../src/lib/IPCWorker.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

Deno.test("IPCWorker hosts a Stageforge actor in another process", async () => {
  PostalService.actors.clear();
  const postal = new PostalService();
  postal.registerWorker("process", IPCWorker);

  const actorId = await timeout(
    postal.add(
      "./actors/processEcho.ts",
      import.meta.url,
      undefined,
      "process",
    ),
    15_000,
  );
  const actor = PostalService.actors.get(actorId);
  assert(
    actor?.worker instanceof IPCWorker,
    "actor should use IPCWorker",
  );

  const payload = { label: "round-trip", count: 3n };
  const echoed = await timeout(
    postal.PostMessage({ target: actorId, type: "ECHO", payload }, true),
    5_000,
  ) as typeof payload;
  assert(
    echoed.label === payload.label,
    "string payload should survive the process boundary",
  );
  assert(
    echoed.count === payload.count,
    "BigInt payload should survive the process boundary",
  );

  const childPid = await timeout(
    postal.PostMessage(
      { target: actorId, type: "PROCESSID", payload: null },
      true,
    ),
    5_000,
  ) as number;
  assert(childPid !== Deno.pid, "actor should execute in a separate process");

  let transferError: unknown;
  try {
    actor.worker.postMessage({ ignored: true }, [new ArrayBuffer(1)]);
  } catch (error) {
    transferError = error;
  }
  assert(
    transferError instanceof DOMException &&
      transferError.name === "DataCloneError",
    "cross-process transfer lists should fail synchronously",
  );

  await postal.murder(actorId);
  const status = await timeout(actor.worker.finished, 5_000);
  assert(
    status.success,
    `worker host should exit cleanly, got code ${status.code}`,
  );
  PostalService.actors.clear();
});
