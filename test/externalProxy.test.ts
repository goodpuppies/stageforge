import { PostalService } from "../src/lib/PostalService.ts";
import { createActorId, type Message } from "../src/lib/types.ts";
function assert(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
/** An actor that was already running before this process attached any route. */
const peer = { value: 41, initialized: 1, shutdowns: 0 };
class ProxyTransport extends EventTarget implements Worker {
  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null;
  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  received: Message[] = [];
  detached = false;
  postMessage(raw: unknown) {
    const message = raw as Message;
    this.received.push(message);
    const base = message.type.split(":")[0];
    if (base === "INIT") peer.initialized++;
    if (base.startsWith("SHUTDOWN")) peer.shutdowns++;
    if (base === "INCREMENT") peer.value++;
    queueMicrotask(() =>
      this.onmessage?.call(
        this,
        new MessageEvent("message", {
          data: {
            address: { fm: message.address.to, to: message.address.fm },
            type: message.type,
            payload: { value: peer.value },
          },
        }),
      )
    );
  }
  terminate() {
    this.detached = true;
  }
}
Deno.test("external proxies attach, route replies and reattach without initializing or shutting down the peer", async () => {
  PostalService.actors.clear();
  peer.value = 41;
  peer.initialized = 1;
  peer.shutdowns = 0;
  const postal = new PostalService();
  const id = createActorId(`external@${crypto.randomUUID()}`);
  const first = new ProxyTransport();
  postal.attachProxy(id, first, {
    transport: "test",
    endpoint: { socket: "/test" },
  });
  assert(
    Number(first.received.length) === 0,
    "attachment sends no INIT/LOADED handshake",
  );
  assert(
    PostalService.actors.get(id)?.ownership === "external",
    "ownership retained",
  );
  const answer = await postal.PostMessage({
    target: id,
    type: "INCREMENT",
    payload: null,
  }, true) as { value: number };
  assert(
    answer.value === 42,
    "ordinary Stageforge callback routed through proxy",
  );
  let rejected = false;
  try {
    await postal.reload(id);
  } catch {
    rejected = true;
  }
  assert(
    rejected && first.received.length === 1,
    "reload cannot invoke remote lifecycle",
  );
  await postal.murder(id);
  assert(
    first.detached && first.onmessage === null,
    "murder detaches local transport",
  );
  assert(
    peer.shutdowns === 0 && peer.initialized === 1 && peer.value === 42,
    "remote actor unchanged",
  );
  const second = new ProxyTransport();
  postal.attachProxy(id, second);
  const again = await postal.PostMessage({
    target: id,
    type: "READ",
    payload: null,
  }, true) as { value: number };
  assert(
    again.value === 42 && peer.initialized === 1,
    "reattach sees existing state and identity",
  );
  postal.detachProxy(id);
  assert(!PostalService.actors.has(id), "route removed");
});
Deno.test("proxy attachment rejects collisions; detach refuses locally owned actors", () => {
  PostalService.actors.clear();
  const postal = new PostalService();
  const id = createActorId(`owned@${crypto.randomUUID()}`);
  const owned = new ProxyTransport();
  PostalService.actors.set(id, { worker: owned });
  let collision = false;
  try {
    postal.attachProxy(id, new ProxyTransport());
  } catch {
    collision = true;
  }
  let detached = false;
  try {
    postal.detachProxy(id);
  } catch {
    detached = true;
  }
  assert(collision && detached && !owned.detached, "existing owner preserved");
  PostalService.actors.clear();
});

Deno.test("external proxy transports can be selected through System attachment messages", async () => {
  PostalService.actors.clear();
  const postal = new PostalService();
  const id = createActorId(`external@${crypto.randomUUID()}`);
  let endpoint: unknown;
  const transport = new ProxyTransport();
  postal.registerProxyTransport("native-test", (value) => {
    endpoint = value;
    return transport;
  });
  await postal.OnMessage(
    {
      address: { fm: id, to: "SYSTEM" },
      type: "ATTACHPROXY",
      payload: {
        actorId: id,
        transport: "native-test",
        endpoint: { path: "/test" },
      },
    } as never,
  );
  assert(
    PostalService.actors.has(id) &&
      (endpoint as { path: string }).path === "/test",
    "endpoint passed to registered transport",
  );
  assert(transport.received.length === 0, "attachment sends no initialization");
  await postal.OnMessage(
    {
      address: { fm: id, to: "SYSTEM" },
      type: "DETACHPROXY",
      payload: { actorId: id },
    } as never,
  );
  assert(
    transport.detached && !PostalService.actors.has(id),
    "System detach closes local proxy only",
  );
});

Deno.test("Iroh ADDREMOTE uses the shared proxy lifecycle and wires replies", async () => {
  PostalService.actors.clear();
  let descriptor: unknown;
  class IrohProxy extends ProxyTransport {
    constructor(value: unknown) {
      super();
      descriptor = value;
    }
  }
  const postal = new PostalService(IrohProxy as never);
  const id = createActorId(`iroh-peer@${crypto.randomUUID()}`);
  try {
    await postal.OnMessage(
      {
        address: { fm: id, to: "SYSTEM" },
        type: "ADDREMOTE",
        payload: { actorId: id, topic: "test", nodeid: "iroh-endpoint" },
      } as never,
    );
    assert(
      (descriptor as { nodeId: string }).nodeId === "iroh-endpoint",
      "contact introduction's nodeid reaches Iroh constructor",
    );
    const entry = PostalService.actors.get(id)!;
    assert(
      entry.ownership === "external",
      "legacy Iroh proxy has explicit external ownership",
    );
    const response = await postal.PostMessage({
      target: id,
      type: "READ",
      payload: null,
    }, true) as { value: number };
    assert(
      typeof response.value === "number",
      "legacy proxy replies now route to callbacks",
    );
    postal.detachProxy(id);
  } finally {
    PostalService.actors.clear();
    new PostalService(Worker);
  }
});

Deno.test("routing a locally owned actor through an Iroh proxy preserves its owner", async () => {
  PostalService.actors.clear();
  class IrohProxy extends ProxyTransport {
    constructor(_descriptor: unknown) {
      super();
    }
  }
  const postal = new PostalService(IrohProxy as never);
  const id = createActorId(`local@${crypto.randomUUID()}`);
  const owner = new ProxyTransport();
  PostalService.actors.set(id, { worker: owner, actorname: "./owned.ts" });
  try {
    // Exercise the existing debug-only route replacement, not external actor attachment.
    (postal as unknown as {
      createProxyActor(actorId: typeof id, node: string, local: boolean): void;
    }).createProxyActor(id, "own-iroh-node", true);
    const entry = PostalService.actors.get(id)!;
    assert(
      entry.ownership !== "external" && entry.ownerWorker === owner,
      "route replacement does not transfer local ownership",
    );
    const route = entry.worker as ProxyTransport;
    await postal.murder(id);
    assert(
      route.detached && owner.detached,
      "owned graph cleans up both proxy route and original worker",
    );
    assert(
      route.received.some((m) => m.type.startsWith("SHUTDOWN_AND_CLOSE:")),
      "owned actor still receives its shutdown hook",
    );
  } finally {
    PostalService.actors.clear();
    new PostalService(Worker);
  }
});
