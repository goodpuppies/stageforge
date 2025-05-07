import { Signal } from "./Signal.ts";
import {
  type Message,
  type MessageFrom,
  type ReturnFrom,
  type GenericActorFunctions,
  System,
  type TopicName,
  type ActorId,
  type ActorW,
} from "./types.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";
import { SignalingClient } from "./SignalingClient.ts";
import type { functions as defaultActorApi } from "./DefaultActorFunctions.ts"


// Worker constructor type that matches the standard Worker constructor
export type WorkerConstructor = new (
  scriptURL: string | URL,
  options?: WorkerOptions
) => Worker;
interface custompayload {
  actorname: string;
  base?: string | URL
}


export class PostalService {
  public static actors: Map<ActorId, ActorW> = new Map();
  public static lastSender: ActorId | null = null;
  public static debugMode = false;
  private static topicRegistry: Map<TopicName, Set<ActorId>> = new Map();
  private callbackMap: Map<symbol, Signal<any>> = new Map();
  private static WorkerClass: WorkerConstructor = Worker;
  private signalingClient: SignalingClient | null = null;

  // Constructor that accepts a custom Worker implementation
  constructor(customWorkerClass?: WorkerConstructor) {
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      LogChannel.log("postalservice", "Using custom Worker implementation");
    }
  }
  //#region signaling
  /**
   * Initialize the signaling client
   * @param serverUrl The WebSocket URL of the signaling server
   */
  initSignalingClient(serverUrl: string): void {
    LogChannel.log("initSignalingClient", serverUrl);
    this.signalingClient = new SignalingClient(serverUrl);

    // Connect to the signaling server
    try {
      this.signalingClient.connect();
    } catch (error) {
      LogChannel.log("postalservice", "Failed to connect to signaling server:", error);
    }
  }


  //#endregion

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
    TOPICUPDATE: async (payload: { delete: boolean; name: TopicName }) => {
      const delmode = payload.delete;
      const topic = payload.name;

      // Identify the actor performing the update
      const actorId = PostalService.lastSender as ActorId;
      if (!actorId) throw new Error("Cannot update topic: sender ID unknown");

      // Update the registry and optionally handle signaling
      if (delmode) {
        PostalService.topicRegistry.get(topic)?.delete(actorId);
        if (this.signalingClient) {
          this.signalingClient.leaveTopic(actorId, topic);
        }
      } else {
        if (!PostalService.topicRegistry.has(topic)) {
          PostalService.topicRegistry.set(topic, new Set());
        }
        const registrySet = PostalService.topicRegistry.get(topic)!;
        if (!registrySet.has(actorId)) {
          registrySet.add(actorId);
          if (PostalService.debugMode) {
            // When in debug, skip local discovery to test signaling only
            LogChannel.debug("postalservice", `skipping local discovery for topic ${topic}`);
            LogChannel.debug("postalservice", `force creating local proxy for ${actorId}`);
            const node = await this.getActorRemoteInfo(actorId)
            this.createProxyActor(actorId, node.nodeId!, true)
          }
          if (this.signalingClient) {
            const info = await this.getActorRemoteInfo(actorId);
            if (!info.nodeId) throw new Error("Cannot subscribe to topic: nodeId unknown");
            this.signalingRegister(actorId, topic, info.nodeId);
          }
        } else {
          console.log("topics not aware of actor")
        }
      }

      // Propagate contact updates only when not in debug mode
      if (!PostalService.debugMode) {
        const topicSet = PostalService.topicRegistry.get(topic);
        if (!topicSet) throw new Error(`Topic ${topic} not found in registry`);
        this.doTopicUpdate(topicSet, actorId, delmode);
      }
    },
    ADDREMOTE: (payload: { actorId: ActorId; topic: TopicName; nodeId: string }) => {
      console.log("ADDREMOTE")
      const { actorId, topic, nodeId } = payload;
      if (!PostalService.actors.has(actorId)) {
        LogChannel.log("postalservice", `addremote: Creating proxy for remote actor ${actorId} @ ${nodeId}`);
        this.createProxyActor(actorId, nodeId, false);
        PostalService.topicRegistry.get(topic)?.add(actorId);
      } else {
        LogChannel.log("postalservice", "addremote: remote actor already exists");
      }
      return true;
    },
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

    const worker = new PostalService.WorkerClass(workerUrl, { name: address, type: "module" });
    worker.onmessage = (event: MessageEvent<Message>) => this.OnMessage(event.data);

    const callbackKey = Symbol('actor-creation');
    const actorSignal = new Signal<ActorId>();
    this.callbackMap.set(callbackKey, actorSignal);

    worker.postMessage({
      address: { fm: System, to: "WORKER" },
      type: "INIT",
      payload: { callbackKey: callbackKey.toString(), originalPayload: null },
    });

    const id = await actorSignal.wait();
    this.callbackMap.delete(callbackKey);

    LogChannel.log("postalserviceCreate", "created", id);
    PostalService.actors.set(id, { worker });
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
    addresses.forEach((address) => {
      message.address.to = address;
      // Don't modify the message type here anymore - let runFunctions handle it
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
    PostalService.lastSender = message.address.fm as ActorId;
  };

  private doTopicUpdate(
    topicSet: Set<ActorId>,
    updater: ActorId,
    delmode: boolean
  ) {
    if (PostalService.debugMode) {
      // Skip local discovery when debugging
      return;
    }
    for (const actorId of topicSet) {
      if (actorId === updater) continue;
      const type = delmode ? "REMOVECONTACT" : "ADDCONTACT";
      this.PostMessage({ target: actorId, type, payload: updater });
      this.PostMessage({ target: updater, type, payload: actorId });
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
  private async getActorRemoteInfo(
    actorId: ActorId
  ): Promise<{ isRemote: boolean; nodeId?: string }> {
    const actor = PostalService.actors.get(actorId);
    if (!actor) return { isRemote: false };

    let isRemote = false;
    try {
      isRemote = (actor.worker as any).isRemote === true ||
        (actor.worker as any).constructor.name === 'IrohWebWorker';
    } catch {
      isRemote = false;
    }

    let nodeId: string | undefined;
    if (typeof (actor.worker as any).getIrohAddr === 'function') {
      try {
        const addr = await (actor.worker as any).getIrohAddr();
        nodeId = addr.nodeId;
      } catch {
        LogChannel.log("postalservice", `Failed to get nodeId for ${actorId}`);
      }
    }

    return { isRemote, nodeId };
  }

  private signalingRegister(
    localActorId: ActorId,
    topic: TopicName,
    nodeId: string
  ) {
    if (!this.signalingClient) return;
    this.signalingClient.joinTopic(localActorId, topic, nodeId);

    this.signalingClient.onJoinTopic(topic, (remoteActorId, remoteNodeId) => {
      if (!remoteNodeId) throw new Error("signaling msg didnt have nodeid, idk")
      if (remoteActorId === localActorId) return;
      if (remoteNodeId && !PostalService.actors.has(remoteActorId)) {
        LogChannel.log(
          "postalservice",
          `signaling: Creating proxy for remote actor ${remoteActorId}`
        );
        this.createProxyActor(remoteActorId, remoteNodeId, false);
        PostalService.topicRegistry.get(topic)?.add(remoteActorId);
      }
      // Introduce new remote to all locals in topic
      PostalService.topicRegistry.get(topic)?.forEach( async (localActorId) => {
        if (localActorId === remoteActorId) return;
        //intro remote to local
        this.PostMessage<typeof defaultActorApi>({
          target: localActorId, type: "ADDCONTACTNODE",
          payload: {
            actorId: remoteActorId,
            topic: topic,
            nodeid: remoteNodeId
          }
        });
        //now we need to tell the remote node that
        //our local actor discovered that remote actor
        //on topic
        //and the local actor can be proxied via this nodeid
        const localnodeid = await this.getActorRemoteInfo(localActorId)
        if (!localnodeid.isRemote) throw new Error("this actor should have an irohnode but doesn't")
        this.PostMessage<typeof defaultActorApi>({
          target: remoteActorId, type: "ADDCONTACTNODE",
          payload: {
            actorId: localActorId,
            topic: topic,
            nodeid: localnodeid.nodeId!
          }
        });
      });
    });
  }

  /**
   * Create a proxy actor (local or remote)
   */
  private createProxyActor(
    actorId: ActorId,
    nodeId: string,
    local: boolean
  ) {
    if (local) {
      const actor = PostalService.actors.get(actorId);
      if (!actor) throw new Error(`Missing actor ${actorId}`);
      //@ts-expect-error iroh worker specific
      (actor.worker as any) = new PostalService.WorkerClass({ nodeId });
    } else {
      //@ts-expect-error iroh worker specific
      const proxy = new PostalService.WorkerClass({ nodeId }) as Worker;
      PostalService.actors.set(actorId, { worker: proxy });
    }
  }
}
