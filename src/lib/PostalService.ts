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
  public static testMode = {
    forceProxyCreation: false // For testing: if true, create proxies for local actors too
  };
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
    console.log("initSignalingClient", serverUrl);
    this.signalingClient = new SignalingClient(serverUrl);

    // Connect to the signaling server
    this.signalingClient.connect().catch(error => {
      console.log("postalservice", "Failed to connect to signaling server:", error);
    });
  }


  //#endregion



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
      // The actor ID is the sender of the message
      const actorId = PostalService.lastSender as ToAddress;

      if (!actorId) {
        throw new Error("Cannot set topic: sender ID unknown");
      }

      const actor = PostalService.actors.get(actorId);
      if (actor) {
        // Add the topic to the actor's topic set
        actor.topics.add(topic);
        console.log("postalservice", `Actor ${actorId} subscribed to topic: ${topic}`);

        // Get the nodeId if this is an IrohWebWorker
        let nodeId: string | undefined;
        try {
          if (typeof (actor.worker as any).getIrohAddr === 'function') {
            const irohAddr = await (actor.worker as any).getIrohAddr();
            if (irohAddr && irohAddr.nodeId) {
              nodeId = irohAddr.nodeId;
            } else {
              console.log("postalservice", `No nodeId available for actor ${actorId}`);
            }
          }
        } catch (error) {
          console.error("postalservice", `Failed to get nodeId for actor ${actorId}:`, error);
        }

        // Register with the signaling server if available
        if (this.signalingClient) {
          try {
            // Register for this specific topic
            this.signalingClient.onJoinTopic(topic, (remoteActorId, remoteNodeId) => {
              console.log("postalservice", `Signaling: Actor ${remoteActorId} joined topic ${topic} with nodeId: ${remoteNodeId || 'local'}`);

              // Only handle remote actors that aren't already in our system
              if (remoteNodeId && !PostalService.actors.has(remoteActorId as ToAddress)) {
                console.log("postalservice", `Creating proxy for remote actor ${remoteActorId}`);
                this.createProxyActor(remoteActorId, remoteNodeId);

                // Add the topic to the newly created actor
                const newActor = PostalService.actors.get(remoteActorId as ToAddress);
                if (newActor) {
                  newActor.topics.add(topic);
                }
              }
            });

            // Join the topic on the signaling server
            this.signalingClient.joinTopic(actorId, topic, nodeId);
            console.log("postalservice", `Registered actor ${actorId} with signaling server for topic ${topic}`);
          } catch (error) {
            console.error("postalservice", `Failed to register with signaling server:`, error);
          }
        } else {
          console.warn("postalservice", "Signaling client not initialized, topic-based discovery will not work");
        }

        // Update addressbooks of all actors in the same topic
        this.updateAddressBooks(actorId, topic);
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

  /**
   * Check if an actor is remote
   */
  private isRemoteActor(actorId: ToAddress): boolean {
    const actor = PostalService.actors.get(actorId);
    if (!actor) return false;

    // Check if this is a proxy worker by examining its constructor
    try {
      // If this worker was created with node ID, it's a remote actor
      return (actor.worker as any).isRemote === true ||
        (actor.worker as any).constructor.name === 'IrohWebWorker';
    } catch (e) {
      return false;
    }
  }

  /**
   * Create a proxy for a local actor (for testing purposes)
   */
  private async createProxyForLocalActor(actorId: ToAddress): Promise<void> {
    // Skip if actor doesn't exist
    if (!PostalService.actors.has(actorId)) {
      return;
    }

    // Add a flag to track which actors we've already processed
    // to avoid infinite recursion
    const actor = PostalService.actors.get(actorId);
    if (!actor || (actor as any)._proxyCreated) {
      return;
    }

    // Mark this actor as processed
    (actor as any)._proxyCreated = true;

    // Skip if we can't get nodeId
    if (typeof (actor.worker as any).getIrohAddr !== 'function') {
      return;
    }

    try {
      // Get the nodeId
      const irohAddr = await (actor.worker as any).getIrohAddr();
      if (!irohAddr || !irohAddr.nodeId) {
        return;
      }

      const nodeId = irohAddr.nodeId;
      console.log("postalservice", `Creating test proxy for local actor ${actorId} with nodeId ${nodeId}`);

      // Save topics
      const existingTopics = actor.topics;

      // Create proxy
      this.createProxyActor(actorId as string, nodeId);

      // Restore topics
      const newActor = PostalService.actors.get(actorId);
      if (newActor) {
        existingTopics.forEach(topic => newActor.topics.add(topic));
      }

      console.log("postalservice", `Successfully created test proxy for actor ${actorId}`);
    } catch (error) {
      console.error("postalservice", `Failed to create test proxy for actor ${actorId}:`, error);
    }
  }


  /**
 * Update address books for all actors when a new actor is added or joins a topic
 * @param newActorId The ID of the actor to add to address books
 * @param topic Optional topic - if provided, only update actors in this topic
 */
  private updateAddressBooks(newActorId: ToAddress, topic?: string): void {
    console.log("postalservice", `Updating address books for actor ${newActorId}${topic ? ` in topic ${topic}` : ''}`);

    const isNewActorRemote = this.isRemoteActor(newActorId);
    const actorsToUpdate: ToAddress[] = [];

    // Find all actors that should be updated
    PostalService.actors.forEach((actor, actorId) => {
      if (actorId === newActorId) return; // Skip the new actor itself

      // If topic is specified, only include actors in that topic
      if (topic && !actor.topics.has(topic)) return;

      actorsToUpdate.push(actorId as ToAddress);

      // Send ADDCONTACT to the existing actor to add the new actor
      this.PostMessage({
        target: actorId,
        type: "ADDCONTACT",
        payload: newActorId
      });

      // If the new actor is remote, we need to tell it about our local actors
      if (isNewActorRemote) {
        this.PostMessage({
          target: newActorId,
          type: "ADDCONTACT",
          payload: actorId
        });
      }

      // Check if we need to create a proxy for the existing actor
      if (PostalService.testMode.forceProxyCreation) {
        this.createProxyForLocalActor(actorId as ToAddress);
      }
    });

    // Only send this for local actors (remote actors were handled in the loop above)
    if (!isNewActorRemote) {
      // Send ADDCONTACT to the new actor for each actor we found
      actorsToUpdate.forEach(existingActorId => {
        this.PostMessage({
          target: newActorId,
          type: "ADDCONTACT",
          payload: existingActorId
        });
      });
    }

    // Check if we need to create a proxy for the new actor
    if (PostalService.testMode.forceProxyCreation) {
      this.createProxyForLocalActor(newActorId);
    }

    CustomLogger.log("postalservice", `Updated ${actorsToUpdate.length} address books with actor ${newActorId}`);
  }

  /**
   * Create a proxy actor for a remote actor
   */
  private createProxyActor(actorId: string, nodeId: string): void {
    // Save existing topics if the actor already exists
    let existingTopics = new Set<string>();
    if (PostalService.actors.has(actorId as ToAddress)) {
      const existingActor = PostalService.actors.get(actorId as ToAddress);
      if (existingActor) {
        existingTopics = existingActor.topics;
        console.log("postalservice", `Replacing existing actor ${actorId} with proxy`);
      }
    }

    console.log("postalservice", `Creating proxy for remote actor ${actorId} with nodeId ${nodeId}`);

    try {
      // Create a proxy worker using the IrohWebWorker with the remote node ID
      //@ts-ignore irohwebworker specific
      const proxyWorker = new PostalService.WorkerClass({ nodeId });

      // Mark this worker as remote
      (proxyWorker as any).isRemote = true;

      // Create an Actor object
      const actor: Actor = {
        worker: proxyWorker,
        topics: new Set(existingTopics) // Copy existing topics
      };

      // Add to the actors map
      PostalService.actors.set(actorId as ToAddress, actor);

      console.log("postalservice", `Successfully created proxy for remote actor ${actorId}`);

      // Update address books for all actors 
      this.updateAddressBooks(actorId as ToAddress);

      // Also update address books for each topic this actor is in
      existingTopics.forEach(topic => {
        this.updateAddressBooks(actorId as ToAddress, topic);
      });
    } catch (error) {
      console.error("postalservice", `Failed to create proxy for remote actor ${actorId}:`, error);
    }
  }
}
