import { Signal } from "./utils.ts";
import {
  type Message,
  type TargetMessage,
  type GenericActorFunctions,
  System,
  type ToAddress,
  type Actor,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { CustomLogger } from "../logger/customlogger.ts";
import { SignalingClient } from "./SignalingClient.ts";

// Worker constructor type that matches the standard Worker constructor
export type WorkerConstructor = new (
  scriptURL: string | URL,
  options?: WorkerOptions
) => Worker;

export class PostalService {
  public static actors: Map<string, Actor> = new Map();
  public static lastSender: ToAddress | null = null;
  public static debugMode = false;
  private callbackMap: Map<symbol, Signal<any>> = new Map();
  public callback: Signal<any> | null = null;
  worker = null;
  private static WorkerClass: WorkerConstructor = Worker;
  private signalingClient: SignalingClient | null = null;

  // Constructor that accepts a custom Worker implementation
  constructor(customWorkerClass?: WorkerConstructor) {
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      CustomLogger.log("postalservice", "Using custom Worker implementation");
    }
  }

  //#region signaling
  /**
   * Initialize the signaling client
   * @param serverUrl The WebSocket URL of the signaling server
   */
  initSignalingClient(serverUrl: string): void {
    CustomLogger.log("initSignalingClient", serverUrl);
    this.signalingClient = new SignalingClient(serverUrl);

    // Connect to the signaling server
    try {
      this.signalingClient.connect();
    } catch (error) {
      CustomLogger.log("postalservice", "Failed to connect to signaling server:", error);
    }
  }


  //#endregion

  //#region postalservice core

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
    LOADED: (payload: { actorId: ToAddress, callbackKey: string }) => {
      CustomLogger.log("postalservice", "new actor loaded, id: ", payload.actorId);

      for (const [key, signal] of this.callbackMap.entries()) {
        if (key.toString() === payload.callbackKey) {

          signal.trigger(payload.actorId);
          return;
        }
      }

      throw new Error("LOADED message received but no matching callback found");
    },
    DELETE: (payload: ToAddress) => {
      PostalService.actors.delete(payload);
    },
    MURDER: (payload: ToAddress) => {
      PostalService.murder(payload);
    },
    SET_TOPIC: async (payload: string) => {
      const topic = payload;

      //#region get actor please refactor
      // The actor ID is the sender of the message BAD CODE!!
      const actorId = PostalService.lastSender as ToAddress;
      if (!actorId) throw new Error("Cannot set topic: sender ID unknown");
      const actor = PostalService.actors.get(actorId);
      //#endregion

      if (actor) {
        // Skip if the actor is already in this topic
        if (actor.topics.has(topic)) {
          console.log("postalservice", `Actor ${actorId} already subscribed to topic: ${topic}`);
          return;
        }
        console.log("postalservice", `Actor ${actorId} subscribed to topic: ${topic}`);

        actor.topics.add(topic);
        const remoteInfo = await this.getActorRemoteInfo(actorId)
        const nodeId = remoteInfo.nodeId;
        if (!nodeId) throw new Error("Cannot subscribe to topic: nodeId unknown");

        if (PostalService.debugMode) {
          CustomLogger.log("postalservice", `DEBUG: creating proxy for local actor ${actorId}`)
          this.createProxyActor(actorId, nodeId, true)
        }
        this.signalingRegister(actorId, topic, nodeId);
      }
    },
    DEL_TOPIC: (payload: string) => {
      // The payload is just the topic string
      const topic = payload;
      // The actor ID is the sender of the message
      const actorId = PostalService.lastSender as ToAddress;

      if (!actorId) {
        throw new Error("Cannot delete topic: sender ID unknown");
      }

      const actor = PostalService.actors.get(actorId);
      if (actor) {
        actor.topics.delete(topic);
        CustomLogger.log("postalservice", `Actor ${actorId} unsubscribed from topic: ${topic}`);

        // Unregister from the signaling server if available
        if (this.signalingClient) {
          this.signalingClient.leaveTopic(actorId, topic);
        }
      }
    },
    ADDREMOTE: (payload: { actorId: ToAddress, topic: string, nodeid: string }) => { 
      const actorid = payload.actorId
      const topic = payload.topic
      const nodeid = payload.nodeid

      //create remote proxy
      if (!PostalService.actors.has(actorid)) {
        console.log("postalservice", `Creating proxy for remote actor ${actorid}`);
        this.createProxyActor(actorid, nodeid, false);
        const newActor = PostalService.actors.get(actorid as ToAddress);
        if (newActor) { newActor.topics.add(topic); }
      }
      return true
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


    const callbackKey = Symbol('actor-creation');
    const actorSignal = new Signal<ToAddress>();
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

  static murder(address: string) {
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
      if (message.type.startsWith("CB")) { message.type = "CB"; }
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
    PostalService.lastSender = message.address.fm as ToAddress;
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

  private async getActorRemoteInfo(actorId: ToAddress, fetchNodeId: boolean = true): Promise<{ isRemote: boolean, nodeId: string | undefined }> {
    const actor = PostalService.actors.get(actorId);
    if (!actor) return { isRemote: false, nodeId: undefined };

    let isRemote = false;
    let nodeId: string | undefined;

    // Check if this is a remote actor
    try {
      isRemote = (actor.worker as any).isRemote === true ||
        (actor.worker as any).constructor.name === 'IrohWebWorker';
    } catch (_) {
      isRemote = false;
    }

    // If fetchNodeId is true and the actor has getIrohAddr method, get the nodeId
    if (fetchNodeId && typeof (actor.worker as any).getIrohAddr === 'function') {
      try {
        const irohAddr = await (actor.worker as any).getIrohAddr();
        if (irohAddr && irohAddr.nodeId) {
          nodeId = irohAddr.nodeId;
        } else {
          nodeId = undefined;
          CustomLogger.log("postalservice", `No nodeId available for actor ${actorId}`);
        }
      } catch (error) {
        console.error("postalservice", `Failed to get nodeId for actor ${actorId}:`, error);
      }
    }

    return { isRemote, nodeId };
  }

  private signalingRegister(localActorId: ToAddress, topic: string, nodeId: string) {
    if (this.signalingClient) {
      this.signalingClient.joinTopic(localActorId, topic, nodeId);

      this.signalingClient.onJoinTopic(topic, (remoteActorId, remoteNodeId) => {

        if (remoteActorId === localActorId) return; //ignore self

        // Only handle remote actors that aren't already in our system
        if (remoteNodeId && !PostalService.actors.has(remoteActorId as ToAddress)) {
          //create remote proxy
          console.log("postalservice", `Creating proxy for remote actor ${remoteActorId}`);
          this.createProxyActor(remoteActorId, remoteNodeId, false);
          // Add the topic to the newly created actor
          const newActor = PostalService.actors.get(remoteActorId as ToAddress);
          if (newActor) {
            newActor.topics.add(topic);
          }
        }
        //introduce remote actor to all local actors in topic
        PostalService.actors.forEach((actor, actorId) => {
          if (remoteActorId === actorId) return; //dont intro remote to remote

          if (actor.topics.has(topic)) {
            //intro remote to local
            this.PostMessage({
              address: { fm: "system", to: actorId },
              type: "ADDCONTACT",
              payload: remoteActorId,
            });
            //do intro the actor back to the remote
            this.PostMessage({
              address: { fm: "system", to: remoteActorId },
              type: "ADDCONTACTNODE",
              payload: {
                actorId: actorId,
                topic: topic,
                nodeId: nodeId
              }
            });
          }

          


        });
      });
    }
  }

  private createProxyActor(actorId: string, nodeId: string, local: boolean): void {
    if (local) {
      try {
        const actor = PostalService.actors.get(actorId) as Actor;
        //@ts-ignore irohwebworker specific
        actor.worker = new PostalService.WorkerClass({ nodeId });
      } catch (error: unknown) {
        console.error("postalservice", `Failed to create test proxy for actor ${actorId}:`, error);
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
    else {
      //@ts-ignore irohwebworker specific
      const proxyworker = new PostalService.WorkerClass({ nodeId }) as Worker;
      // Create an Actor object
      const actor: Actor = {
        worker: proxyworker,
        topics: new Set<string>()
      };
      PostalService.actors.set(actorId, actor);
    }
  }
}
