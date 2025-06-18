import { Signal } from "./Signal.ts";
import {
  type ActorId,
  type ActorW,
  type custompayload,
  type GenericActorFunctions,
  type Message,
  type MessageFrom,
  type ReturnFrom,
  type reverseProxy,
  System,
  type TopicName,
  type WorkerConstructor,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";
import { assert } from "@goodpuppies/logicalassert";
import { WsClientProxyWorker } from "../../../WebsockWorker/WsClientProxyWorker.ts";
import { WsClientWorker } from "../../../WebsockWorker/WsClientWorker.ts";

export class PostalService {
  public static actors: Map<ActorId, ActorW> = new Map();
  public sender?: ActorId;
  public static debugMode = false;
  private static topicRegistry: Map<TopicName, Set<ActorId>> = new Map();
  private callbackMap: Map<symbol, Signal<any>> = new Map();
  private static WorkerClass: WorkerConstructor = Worker;

  // Constructor that accepts a custom Worker implementation
  constructor(customWorkerClass?: WorkerConstructor) {
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      LogChannel.log("postalservice", "Using custom Worker implementation");
    }
  }

  public functions:GenericActorFunctions = {
    CREATE: async (payload: custompayload) => {

      const id = await assert(payload).with({
        object: async (payload: { file: string; base?: string | URL }) => {
          return await this.add(payload)
        },
        "PROXY": async () => {
          return await this.functions.CREATEWSPROXY(null, this)
        }
      })

      LogChannel.log("postalserviceCreate", "created actor id: ", id, "sending back to creator");
      return id;
    },
    LOADED: (payload: { actorId: ActorId; callbackKey: string }) => {
      LogChannel.log("postalservice", "new actor loaded, id: ", payload.actorId);
      for (const [key, signal] of this.callbackMap.entries()) {
        if (key.toString() === payload.callbackKey) {
          signal.trigger(payload.actorId);
          return;
        }
      }
      throw new Error("LOADED message received but no matching callback found");
    },
    DELETE: (payload: ActorId) => {
      PostalService.actors.delete(payload);
    },
    MURDER: (payload: ActorId) => {
      PostalService.murder(payload);
    },
    TOPICUPDATE: (payload: { delete: boolean; name: TopicName }, ctx: PostalService) => {
      this.topicUpdate(payload, ctx);
    },
    //#region websocket
    CREATEWSCLIENT: async ({ file, url }: { file: string, url: string }) => {

      const fileUrl = new URL(file, `file://${Deno.cwd()}/`).href;
      const worker = new WsClientWorker(fileUrl, url, { name: file, type: "module" }) as Worker

      worker.onmessage = (event: MessageEvent<Message>) => {
        this.OnMessage(event.data);
      };

      const callbackKey = Symbol("actor-creation");
      const actorSignal = new Signal<ActorId>();
      this.callbackMap.set(callbackKey, actorSignal);

      // Send the INIT message with the callback key in the payload
      worker.postMessage({
        address: { fm: System, to: "WORKER" },
        type: "INIT",
        payload: {
          callbackKey: callbackKey.toString(),
          originalPayload: null,
        },
      });

      const id = await actorSignal.wait(); //id
      this.callbackMap.delete(callbackKey);
      const actor: ActorW = {
        worker,
      };
      PostalService.actors.set(id, actor);
      return id;
    },
    CREATEWSPROXY: async () => {
      console.log("creating proxy");

      const worker: Worker = new WsClientProxyWorker({ port: 9992 });
      console.log("created proxy");
      worker.onmessage = (event: MessageEvent<Message>) => {
        this.OnMessage(event.data);
      };

      const callbackKey = Symbol("actor-creation");
      const actorSignal = new Signal<ActorId>();
      this.callbackMap.set(callbackKey, actorSignal);

      // Create an Actor object 
      // we need to keep track of this so should be uuid
      const id = await actorSignal.wait() as ActorId;
      console.log("created actor");
      const actor: ActorW = {
        worker,
      };
      PostalService.actors.set(id, actor);
      return id;
    },
    //#endregion
  };

  private async add(input: { file: string; base?: string | URL } | reverseProxy): Promise<ActorId> {
    LogChannel.log("postalserviceCreate", "creating", input);
    // Resolve relative to Deno.cwd()
    console.log(input);

    const id = await assert(input).with({
      object: async (input: { file: string; base?: string | URL }) => {
        console.log("jhmm", input);
        const workerUrl = assert(typeof Deno).with({
          object: () => {
            return new URL(input.file, input.base ?? `file://${Deno.cwd()}/`).href;
          },
          undefined: () => {
            const baseUrl = globalThis.location.href.substring(
              0,
              globalThis.location.href.lastIndexOf("/") + 1,
            );
            return new URL(input.file, baseUrl).href;
          },
        });

        console.log("creating worker", workerUrl);
        const worker: Worker = new PostalService.WorkerClass(
          workerUrl,
          { name: input.file, type: "module" },
        );
        worker.onmessage = (event: MessageEvent<Message>) => {
          this.OnMessage(event.data);
        };

        const callbackKey = Symbol("actor-creation");
        const actorSignal = new Signal<ActorId>();
        this.callbackMap.set(callbackKey, actorSignal);

        // Send the INIT message with the callback key in the payload
        worker.postMessage({
          address: { fm: System, to: "WORKER" },
          type: "INIT",
          payload: {
            callbackKey: callbackKey.toString(),
            originalPayload: null,
          },
        });

        // Create an Actor object

        const id = await actorSignal.wait(); //id
        this.callbackMap.delete(callbackKey);
        const actor: ActorW = {
          worker,
        };
        PostalService.actors.set(id, actor);
        return id;
      },
    });

    LogChannel.log("postalserviceCreate", "created", id);

    return id;
  }

  static murder(address: ActorId) {
    //needs more work lol
    const actor = PostalService.actors.get(address);
    if (actor) {
      actor.worker.terminate();
      PostalService.actors.delete(address);
    }
  }

  //#region topic system
  topicUpdate(payload: { delete: boolean; name: TopicName }, ctx: PostalService) {
    const { actorId, actor } = assert(ctx.sender).with({
      string: (actorId: ActorId) => {
        return { actorId, actor: PostalService.actors.get(actorId) };
      },
    });

    assert(actor).with({
      actorWorker: {
        condition: { worker: "object" },
        exec: () => {
          assert(payload.delete).with({
            true: () => {
              PostalService.topicRegistry.get(payload.name)?.delete(actorId);
            },
            false: () => {
              if (!PostalService.topicRegistry.has(payload.name)) {
                PostalService.topicRegistry.set(payload.name, new Set());
              }
              PostalService.topicRegistry.get(payload.name)?.add(actorId);
              if (PostalService.debugMode) {
                console.log(`Registered actor ${actorId} to topic ${payload.name}`);
              }
            },
          });
        },
      },
    });

    const tobj = assert(PostalService.topicRegistry.get(payload.name)).with({
      object: (tobj: Set<ActorId>) => {
        return tobj;
      },
    });

    this.doTopicUpdate(tobj, actorId, payload.delete);
  }

  doTopicUpdate(topic: Set<ActorId>, updater: ActorId, delmode: boolean) {
    for (const actor of topic) {
      if (actor === updater) continue;
      if (delmode) {
        this.PostMessage({
          target: actor,
          type: "REMOVECONTACT",
          payload: updater,
        });
        this.PostMessage({
          target: updater,
          type: "REMOVECONTACT",
          payload: actor,
        });
      } else {
        this.PostMessage({
          target: actor,
          type: "ADDCONTACT",
          payload: updater,
        });
        this.PostMessage({
          target: updater,
          type: "ADDCONTACT",
          payload: actor,
        });
      }
    }
  }

  //#endregion

  //#region postalservice core

  OnMessage = (message: Message): void => {
    LogChannel.log("postalserviceOnMessage", "postalService handleMessage", message);
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];
    this.sender = message.address.fm;

    addresses.forEach((address) => {
      message.address.to = address;
      if (message.address.to === System) {
        runFunctions(message, this.functions, this);
      } else {
        if (!PostalService.actors.has(message.address.to)) {
          console.error("postal service does not have: ", message.address.to);
          console.error("debugmode: ", PostalService.debugMode);
          console.error("fullmsg:", message);
          throw new Error("postal service does not have: " + message.address.to);
        }
        PostalService.actors.get(message.address.to)!.worker.postMessage(message);
      }
    });
  };

  PostMessage<
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  PostMessage<
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  PostMessage<
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb?: boolean): any {
    return PostMessage(message as any, cb, this);
  }

  //#endregion
}
