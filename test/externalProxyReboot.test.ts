import { rebootActorGraph } from "../src/lib/ActorLifecycle.ts";
import { type ActorW, createActorId } from "../src/lib/types.ts";
Deno.test("graph reboot detaches external proxies without invoking remote shutdown", async () => {
  const root = createActorId(`root@${crypto.randomUUID()}`);
  const external = createActorId(`external@${crypto.randomUUID()}`);
  const nextRoot = createActorId(`root@${crypto.randomUUID()}`);
  const terminated: string[] = [];
  const worker = (id: string) =>
    ({ terminate: () => terminated.push(id) }) as unknown as Worker;
  const actors = new Map<typeof root, ActorW>([
    [root, { worker: worker(root), actorname: "./root.ts" }],
    [external, { worker: worker(external), ownership: "external" }],
  ]);
  const lifecycle: string[] = [];
  const result = await rebootActorGraph({
    actors,
    rootActor: {
      actorId: root,
      actorname: "./root.ts",
      startType: "MAIN",
      startPayload: null,
    },
    payload: null,
    post: (message) => {
      lifecycle.push(`${message.target}:${message.type}`);
      return true;
    },
    add: async () => nextRoot,
    clearTopics: () => {},
    clearCallbacks: () => {},
    setRootActor: () => {},
  });
  if (
    result.actorId !== nextRoot || !terminated.includes(external) ||
    !terminated.includes(root)
  ) throw new Error("Connections and owned workers must close");
  if (lifecycle.some((s) => s.startsWith(`${external}:`))) {
    throw new Error(
      "No lifecycle command may be sent to the external actor during reboot",
    );
  }
});
