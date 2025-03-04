import { Signal } from "./utils.ts";
import {
  type Message,
  type TargetMessage,
  type GenericActorFunctions,
  System,
  type ToAddress,
} from "./types.ts";
import { CustomLogger } from "../logger/customlogger.ts";
import { PostMessage, runFunctions } from "./shared.ts";

export class PostalService {
  public static actors: Map<string, Worker> = new Map();
  public callback: Signal<unknown> | null = null;
  static initSignal: Signal<ToAddress>;
  worker = null

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
    }
  };

  async add(address: string): Promise<ToAddress> {
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
    PostalService.actors.set(id, worker);
    return id;
  }

  static murder(address: string) {
    const worker = PostalService.actors.get(address);
    if (worker) {
      worker.terminate();
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
        (PostalService.actors.get(message.address.to)!).postMessage(message);
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
