import { Signal } from "./utils.ts";
import {
  type Message,
  type TargetMessage,
  type GenericActorFunctions,
  System,
  type ToAddress,
  type Actor,
} from "./types.ts";
import { CustomLogger } from "../logger/customlogger.ts";
import { PostMessage, runFunctions } from "./shared.ts";

// Worker constructor type that matches the standard Worker constructor
export type WorkerConstructor = new (
  scriptURL: string | URL,
  options?: WorkerOptions
) => Worker;

export class PostalService {
  public static actors: Map<string, Actor> = new Map();
  public callback: Signal<unknown> | null = null;
  static initSignal: Signal<ToAddress>;
  worker = null;
  
  // Custom Worker constructor
  private static WorkerClass: WorkerConstructor = Worker;

  // Constructor that accepts a custom Worker implementation
  constructor(customWorkerClass?: WorkerConstructor) {
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      CustomLogger.log("postalservice", "Using custom Worker implementation");
    }
  }

  public functions: GenericActorFunctions = {
    CREATE: async (payload: string) => {
      const id = await this.add(payload);
      CustomLogger.log("postalservice", "created actor id: ", id, "sending back to creator")
      return id
    },
    CB: (payload: unknown) => {
      if (!this.callback) {
        console.log("CB", payload);
        throw new Error("UNEXPECTED CALLBACK");
      }
      this.callback.trigger(payload);
    },
    LOADED: (payload: ToAddress) => {
      CustomLogger.log("postalservice", "new actor loaded, id: ", payload)
      PostalService.initSignal.trigger(payload);
    },
    DELETE: (payload: ToAddress) => {
      PostalService.actors.delete(payload);
    },
    MURDER: (payload: ToAddress) => {
      PostalService.murder(payload);
    },
    SET_TOPIC: (payload: { actorId: ToAddress, topic: string }) => {
      const { actorId, topic } = payload;
      const actor = PostalService.actors.get(actorId);
      if (actor) {
        actor.topics.add(topic);
        CustomLogger.log("postalservice", `Actor ${actorId} subscribed to topic: ${topic}`);
      }
    },
    DEL_TOPIC: (payload: { actorId: ToAddress, topic: string }) => {
      const { actorId, topic } = payload;
      const actor = PostalService.actors.get(actorId);
      if (actor) {
        actor.topics.delete(topic);
        CustomLogger.log("postalservice", `Actor ${actorId} unsubscribed from topic: ${topic}`);
      }
    }
  };

  async add(address: string): Promise<ToAddress> {
    CustomLogger.log("postalservice", "creating", address);
    // Resolve relative to Deno.cwd()
    const workerUrl = new URL(address, `file://${Deno.cwd()}/`).href;
    const worker: Worker = new PostalService.WorkerClass(
      workerUrl,
      { name: address, type: "module" }
    );
    worker.onmessage = (event: MessageEvent<Message>) => { this.OnMessage(event.data); };

    //#region init sig
    PostalService.initSignal = new Signal<ToAddress>();
    worker.postMessage({
      address: { fm: System, to: "WORKER" },
      type: "INIT",
      payload: null,
    });
    const id = await PostalService.initSignal.wait();
    //#endregion
    CustomLogger.log("postalservice", "created", id);
    
    // Create an Actor object
    const actor: Actor = {
      worker,
      topics: new Set<string>()
    };
    
    PostalService.actors.set(id, actor);
    return id;
  }

  static murder(address: string) {
    const actor = PostalService.actors.get(address);
    if (actor) {
      actor.worker.terminate();
      PostalService.actors.delete(address);
    }
  }

  OnMessage = (message: Message) : void =>  {
    CustomLogger.log("postalservice", "postalService handleMessage", message);
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];
    addresses.forEach((address) => {
      message.address.to = address;
      if (message.type.startsWith("CB")) { message.type = "CB"; }
      if (message.address.to === System) {
        runFunctions(message, this.functions, this)
      }
      else {
        if (!PostalService.actors.has(message.address.to)) { throw new Error() }
        (PostalService.actors.get(message.address.to)!.worker).postMessage(message);
      }
    });
  };

  async PostMessage(
    message: TargetMessage | Message,
    cb: true
  ): Promise<unknown>;
  PostMessage(
    message: TargetMessage | Message,
    cb?: false
  ): void;
  async PostMessage(
    message: TargetMessage | Message,
    cb?: boolean
  ): Promise<unknown | void> {
    return await PostMessage(message, cb, this)
  }
}
