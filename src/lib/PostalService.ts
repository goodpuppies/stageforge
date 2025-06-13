import { Signal } from "./Signal.ts";
import {
  System,
  type custompayload,
  type WorkerConstructor,
  type Message,
  type MessageFrom,
  type ReturnFrom,
  type GenericActorFunctions,
  type TopicName,
  type ActorId,
  type ActorW,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";

export class PostalService {
  public static actors: Map<ActorId, ActorW> = new Map();
  public sender?: ActorId
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

  //#region postalservice core

  public functions: GenericActorFunctions = {

    CREATE: async (payload: custompayload ) => {

      const id = await this.add(payload.actorname, payload.base);
      LogChannel.log("postalserviceCreate", "created actor id: ", id, "sending back to creator")
      return id
    },
    LOADED: (payload: { actorId: ActorId, callbackKey: string }) => {
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
    TOPICUPDATE: (payload: { delete: boolean, name: TopicName }, ctx) => {

      const actorId = ctx.sender
      if (!actorId) throw new Error("Cannot set topic: sender ID unknown");
      const actor = PostalService.actors.get(actorId);

      if (actor) {
        if (payload.delete) {
          PostalService.topicRegistry.get(payload.name)?.delete(actorId);
        } else {
          if (!PostalService.topicRegistry.has(payload.name)) {
            PostalService.topicRegistry.set(payload.name, new Set());
          }
          PostalService.topicRegistry.get(payload.name)?.add(actorId);
          if (PostalService.debugMode) {
            console.log(`Registered actor ${actorId} to topic ${payload.name}`);
          }
        }
      }
      const tobj = PostalService.topicRegistry.get(payload.name)
      if (!tobj) throw new Error("wat")
      this.doTopicUpdate(tobj, actorId, payload.delete)
    }
  };

  async add(address: string, base?: string | URL): Promise<ActorId> {
    LogChannel.log("postalserviceCreate", "creating", address);
    // Resolve relative to Deno.cwd()

    let workerUrl: string;
    if (typeof Deno !== 'undefined') {
      workerUrl = new URL(address, base ?? `file://${Deno.cwd()}/`).href;
    } else {
      const baseUrl = globalThis.location.href.substring(0, globalThis.location.href.lastIndexOf('/') + 1);
      workerUrl = new URL(address, baseUrl).href;
    }

    const worker: Worker = new PostalService.WorkerClass(
      workerUrl,
      { name: address, type: "module" }
    );
    worker.onmessage = (event: MessageEvent<Message>) => { this.OnMessage(event.data); };


    const callbackKey = Symbol('actor-creation');
    const actorSignal = new Signal<ActorId>();
    this.callbackMap.set(callbackKey, actorSignal);

    // Send the INIT message with the callback key in the payload
    worker.postMessage({
      address: { fm: System, to: "WORKER" },
      type: "INIT",
      payload: {
        callbackKey: callbackKey.toString(),
        originalPayload: null
      },
    });


    const id = await actorSignal.wait();


    this.callbackMap.delete(callbackKey);

    LogChannel.log("postalserviceCreate", "created", id);

    // Create an Actor object
    const actor: ActorW = {
      worker
    };

    PostalService.actors.set(id, actor);
    return id;
  }

  static murder(address: ActorId) {
    const actor = PostalService.actors.get(address);
    if (actor) {
      actor.worker.terminate();
      PostalService.actors.delete(address);
    }
  }

  OnMessage = (message: Message): void => {
    LogChannel.log("postalserviceOnMessage", "postalService handleMessage", message);
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];
    this.sender = message.address.fm
    
    addresses.forEach((address) => {
      message.address.to = address;
      if (message.address.to === System) {
        runFunctions(message, this.functions, this)
      }
      else {
        if (!PostalService.actors.has(message.address.to)) {
          console.error("postal service does not have: ", message.address.to)
          console.error("fullmsg:", message)
          throw new Error("postal service does not have: " + message.address.to)
        }
        (PostalService.actors.get(message.address.to)!.worker).postMessage(message);
      }
    });
  };

  doTopicUpdate(topic: Set<ActorId>, updater: ActorId, delmode: boolean) {
    for (const actor of topic) {
      if (actor === updater) { continue; }
      if (delmode) {
        this.PostMessage({
          target: actor,
          type: "REMOVECONTACT",
          payload: updater
        })
        this.PostMessage({
          target: updater,
          type: "REMOVECONTACT",
          payload: actor
        })
      } else {
        this.PostMessage({
          target: actor,
          type: "ADDCONTACT",
          payload: updater
        })
        this.PostMessage({
          target: updater,
          type: "ADDCONTACT",
          payload: actor
        })
      }
    }
  }

  PostMessage<
      T extends Record<string, (payload: any) => any>
    >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
    PostMessage<
      T extends Record<string, (payload: any) => any>
    >(message: MessageFrom<T>, cb?: false | undefined): void;
    // Implementation
    PostMessage<
      T extends Record<string, (payload: any) => any>
    >(message: MessageFrom<T>, cb?: boolean): any {
      return PostMessage(message as any, cb, this);
    }

  //#endregion
}
