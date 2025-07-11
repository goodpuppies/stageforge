import { SignalEvent } from "./Signal.ts";
import {
  type ActorId,
  type ActorW,
  type GenericActorFunctions,
  type Message,
  type MessageFrom,
  type ReturnFrom,
  System,
  type TopicName,
  type WorkerConstructor,
  type workerpayload,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";
import { assert } from "@goodpuppies/logicalassert";

export class PostalService {
  public static actors: Map<ActorId, ActorW> = new Map();
  public sender?: ActorId | typeof System = System;
  public static debugMode = false;
  private static topicRegistry: Map<TopicName, Set<ActorId>> = new Map();

  private static WorkerClass: WorkerConstructor = Worker;

  constructor(customWorkerClass?: WorkerConstructor) {
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      LogChannel.log("postalservice", "Using custom Worker implementation");
    }
  }

  public register(newFunctions: GenericActorFunctions) {
    this.functions = { ...this.functions, ...newFunctions };
  }

  public functions: GenericActorFunctions = {
    //deno-lint-ignore no-explicit-any
    CREATE: async (payload: workerpayload, ctx: any) => {
      //should be an assertion
      let parentId;
      if (payload.parent) {
        parentId = payload.parent;
      } else if (ctx?.sender) {
        parentId = ctx.sender;
      } else {
        parentId = System;
      }
      LogChannel.log("postalserviceCreate", "create called by:", parentId, "override:", payload.parent);

      const id = await this.add({ file: payload.file, parent: parentId, base: payload.base });
      LogChannel.log("postalserviceCreate", "created actor id: ", id, "sending back to creator");
      return id;
    },
    LOADED: (payload: { actorId: ActorId; callbackKey: string }) => {
      LogChannel.log("postalservice", "new actor loaded, id: ", payload.actorId);
      SignalEvent.trigger(payload.callbackKey, payload.actorId);
    },
    DELETE: (payload: ActorId) => {
      PostalService.actors.delete(payload);
    },
    MURDER: (payload: ActorId) => {
      PostalService.murder(payload);
    },
    TOPICUPDATE: async (payload: { delete: boolean; name: TopicName }, ctx: PostalService) => {
      await this.topicUpdate(payload, ctx);
    },
  };

  private async add(input: { file: string | URL; parent: ActorId | undefined; base?: string | URL }): Promise<ActorId> {
    LogChannel.log("postalserviceCreate", "creating", input);
    // Resolve relative to Deno.cwd()

    const id = await assert(input).with({
      object: async (input: { file: string; parent: ActorId | undefined; base?: string | URL }) => {
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
        if (PostalService.debugMode) {
          console.log("creating worker", workerUrl);
        }
        const worker: Worker = new PostalService.WorkerClass(
          workerUrl,
          { name: input.file, type: "module" },
        );
        worker.onmessage = (event: MessageEvent<Message>) => {
          this.OnMessage(event.data);
        };

        const actorSignal = new SignalEvent<ActorId>("actor-creation", 1000);

        // Send the INIT message with the callback key in the payload
        worker.postMessage({
          address: { fm: System, to: "WORKER" },
          type: "INIT",
          payload: {
            callbackKey: actorSignal.id,
            originalPayload: null,
            parentId: input.parent,
          },
        });

        // Create an Actor object
        const id = await actorSignal.wait(); //id
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
  async topicUpdate(payload: { delete: boolean; name: TopicName }, ctx: PostalService) {
    const actorId = assert(ctx.sender).with({
      string: (actorId: ActorId) => {
        return actorId;
      },
    });

    let actor = PostalService.actors.get(actorId);
    const timeout = 1000; // 1 second timeout
    const pollInterval = 50; // 50 ms
    let elapsedTime = 0;

    while (!actor && elapsedTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      actor = PostalService.actors.get(actorId);
      elapsedTime += pollInterval;
    }

    if (!actor) {
      throw new Error(`topicUpdate timed out waiting for actor ${actorId} to be registered.`);
    }

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
        message.address.to = message.address.to as ActorId;

        if (!PostalService.actors.has(message.address.to)) {
          if (message.address.fm === System) {
            throw new Error("System to System message invalid");
          }
          const actor = PostalService.actors.get(message.address.fm as ActorId);

          // deno-lint-ignore no-explicit-any
          if ((actor as any).worker.modded) {
            return;
          }

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
    T extends Record<string, (payload: unknown) => unknown>,
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  PostMessage<
    T extends Record<string, (payload: unknown) => unknown>,
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  PostMessage<
    T extends Record<string, (payload: unknown) => unknown>,
  >(message: MessageFrom<T>, cb?: boolean): unknown {
    return PostMessage(message, cb, this);
  }

  //#endregion
}
