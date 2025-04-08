import { Signal } from "./utils.ts";
import {
  type Message,
  type TargetMessage,
  type GenericActorFunctions,
  System,
  type ActorId,
  createActorId,
  type worker,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { CustomLogger } from "../logger/customlogger.ts";

// Define Actor interface with proper types
interface Actor {
  worker: Worker;
  topics: Set<string>;
}

export class PostalService {
  public static actors: Map<ActorId, Actor> = new Map();
  public static lastSender: ActorId | null = null;
  private callbackMap: Map<symbol, Signal<any>> = new Map();

  //#region postalservice core

  public functions: GenericActorFunctions = {
    CREATE: async (payload: string) => {
      const id = await this.add(payload);
      CustomLogger.log("postalservice", "created actor id: ", id, "sending back to creator")
      return id
    },
    LOADED: (payload: { actorId: ActorId, callbackKey: string }) => {
      CustomLogger.log("postalservice", "new actor loaded, id: ", payload.actorId);

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
    }
  };

  async add(address: string): Promise<ActorId> {
    CustomLogger.log("postalservice", "creating", address);
    let workerUrl: string;
    if (typeof Deno !== 'undefined') {
      workerUrl = new URL(address, `file://${Deno.cwd()}/`).href;
    } else {
      const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
      workerUrl = new URL(address, baseUrl).href;
    }
    const worker: Worker = new Worker(
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

    CustomLogger.log("postalservice", "created", id);

    // Create an Actor object
    const actor: Actor = {
      worker,
      topics: new Set<string>()
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
    //CustomLogger.log("postalservice", "postalService handleMessage", message);
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];
    addresses.forEach((address) => {
      message.address.to = address;
      // Don't modify the message type here anymore - let runFunctions handle it
      if (message.address.to === System) {
        runFunctions(message, this.functions, this)
      }
      else {
        if (!PostalService.actors.has(message.address.to as ActorId)) {
          console.error("postal service does not have: ", message.address.to)
          console.error("fullmsg:", message)
          throw new Error("postal service does not have: " + message.address.to)
        }
        (PostalService.actors.get(message.address.to as ActorId)!.worker).postMessage(message);
      }
    });
    PostalService.lastSender = message.address.fm as ActorId;
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
    return await PostMessage(message, cb, this);
  }

  //#endregion
}
