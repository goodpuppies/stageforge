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
    forceProxyCreation: true // For testing: if true, create proxies for local actors too
  };
  public static debugMode = false; // Flag to enable debug mode behavior
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
      // The actor ID is the sender of the message BAD CODE
      const actorId = PostalService.lastSender as ToAddress;
      if (!actorId) throw new Error("Cannot set topic: sender ID unknown");
      const actor = PostalService.actors.get(actorId);

      if (actor) {
        // Skip if the actor is already in this topic
        if (actor.topics.has(topic)) {
          console.log("postalservice", `Actor ${actorId} already subscribed to topic: ${topic}`);
          return;
        }
        
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
            // Join the topic on the signaling server
            this.signalingClient.joinTopic(actorId, topic, nodeId);

            //Start listening on the topic
            this.signalingClient.onJoinTopic(topic, (remoteActorId, remoteNodeId) => {
              CustomLogger.log("signaling", `Signaling: Actor ${remoteActorId} joined topic ${topic} with nodeId: ${remoteNodeId || 'local'}`);

              // Only handle remote actors that aren't already in our system
              if (remoteNodeId && !PostalService.actors.has(remoteActorId as ToAddress)) {
                console.log("postalservice", `Creating proxy for remote actor ${remoteActorId}`);
                this.createProxyActor(remoteActorId, remoteNodeId);


                // Add the topic to the newly created actor # HMM???
                const newActor = PostalService.actors.get(remoteActorId as ToAddress);
                if (newActor) {
                  newActor.topics.add(topic);
                }
              } 
              // Handle local actors from the same process in debug mode
              else if (PostalService.debugMode && PostalService.actors.has(remoteActorId as ToAddress) && remoteActorId !== actorId) {
                console.log("postalservice", `Handling local actor ${remoteActorId} in debug mode`);
                
                // Update address books to connect local actors
                this.updateAddressBooks(remoteActorId as ToAddress, topic);
              }
            });


            console.log("postalservice", `Registered actor ${actorId} with signaling server for topic ${topic}`);
          } catch (error) {
            console.error("postalservice", `Failed to register with signaling server:`, error);
          }
        } else {
          console.warn("postalservice", "Signaling client not initialized, topic-based discovery will not work");
        }

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
    ADDREMOTE: (payload: { address: ToAddress, nodeid: any }) => {
      const add = payload.address
      const id = payload.nodeid
      this.createProxyActor(add, id)
      return true
    },
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
          throw new Error()
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
    } catch (_) {
      return false;
    }
  }

  /**
   * Update address books for all actors when a new actor is added or joins a topic
   * @param newActorId The ID of the actor to add to address books
   * @param topic Optional topic - if provided, only update actors in this topic
   * @param skipProxyCreation If true, skip creating proxies to avoid recursive calls
   */
  private updateAddressBooks(newActorId: ToAddress, topic?: string, skipProxyCreation: boolean = false): Promise<void> {
    console.log("postalservice", `Updating address books for actor ${newActorId}${topic ? ` in topic ${topic}` : ''}`);

    const isNewActorRemote = this.isRemoteActor(newActorId);
    const actorsToUpdate: ToAddress[] = [];
    
    // Keep track of which actors we've already processed to avoid duplicates
    const processedPairs = new Set<string>();
    
    // Get the new actor to check its topics
    const newActor = PostalService.actors.get(newActorId);
    const newActorTopics = newActor ? Array.from(newActor.topics) : [];
    
    console.log("postalservice", `Actor ${newActorId} has topics: [${newActorTopics.join(', ')}]`);

    // Find all actors that should be updated
    PostalService.actors.forEach((actor, actorId) => {
      if (actorId === newActorId) return; // Skip the new actor itself

      const actorTopics = Array.from(actor.topics);
      
      // Determine if actors should be updated based on topics
      let shouldUpdate = false;
      let updateReason = "";
      
      if (topic) {
        // If a specific topic is provided, only include actors in that topic
        shouldUpdate = actor.topics.has(topic);
        updateReason = shouldUpdate ? 
          `Actor ${actorId} is in the specified topic ${topic}` : 
          `Actor ${actorId} is NOT in the specified topic ${topic}`;
      } else {
        // Check if actors share any topics - ALWAYS enforce topic boundaries
        const sharedTopics = actorTopics.filter(t => newActorTopics.includes(t));
        
        if (sharedTopics.length > 0) {
          shouldUpdate = true;
          updateReason = `Actor ${actorId} shares topics with ${newActorId}: [${sharedTopics.join(', ')}]`;
        } else {
          shouldUpdate = false;
          updateReason = `Actor ${actorId} does not share any topics with ${newActorId}`;
        }
      }
      
      // Debug logging to help understand what's happening
      //console.log("postalservice", `Should update ${actorId}? ${shouldUpdate}. Reason: ${updateReason}`);
      
      // Skip actors that don't meet our update criteria
      if (!shouldUpdate) {
        return;
      }

      // Create a unique key for this actor pair to track if we've processed it
      const pairKey = `${actorId}-${newActorId}`;
      const reversePairKey = `${newActorId}-${actorId}`;
      
      // Skip if we've already processed this pair
      if (processedPairs.has(pairKey) || processedPairs.has(reversePairKey)) {
        console.log("postalservice", `Skipping duplicate update for actors ${actorId} and ${newActorId}`);
        return;
      }
      
      // Mark this pair as processed
      processedPairs.add(pairKey);
      processedPairs.add(reversePairKey);

      actorsToUpdate.push(actorId as ToAddress);

      // Send ADDCONTACT to the existing actor to add the new actor
      this.PostMessage({
        target: actorId,
        type: "ADDCONTACT",
        payload: newActorId
      });

      // If the new actor is remote, we need to tell it about our local actors
      if (isNewActorRemote) {
        const actor = PostalService.actors.get(actorId);
        if (!actor) return;
        
        try {
          const irohAddr = (actor.worker as any).getIrohAddr();
          if (!irohAddr || !irohAddr.nodeId) return;
          
          const node = irohAddr.nodeId;
          if (!node) throw new Error("NodeId not available");
          if (newActorId == actorId) throw new Error("Cannot add self as remote");
          
          this.PostMessage({
            target: newActorId,
            type: "ADDCONTACTNODE",
            payload: {
              address: actorId,
              nodeid: node
            }
          });
        } catch (error) {
          console.error("postalservice", `Failed to add remote contact for ${actorId}:`, error);
        }
      }

      // Check if we need to create a proxy for the existing actor
      // Only do this if we're not in a recursive proxy creation call
      if (!skipProxyCreation && PostalService.debugMode && PostalService.testMode.forceProxyCreation && actor.topics.size > 0) {
        this.createProxyForLocalActor(actorId as ToAddress).catch(error => {
          console.error("postalservice", `Failed to create proxy for actor ${actorId}:`, error);
        });
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
    // Only do this if we're not in a recursive proxy creation call
    if (!skipProxyCreation && PostalService.debugMode && PostalService.testMode.forceProxyCreation && newActor && newActor.topics.size > 0) {
      return this.createProxyForLocalActor(newActorId).then(() => {
        CustomLogger.log("postalservice", `Updated ${actorsToUpdate.length} address books with actor ${newActorId}`);
      }).catch(error => {
        console.error("postalservice", `Failed to create proxy for new actor ${newActorId}:`, error);
        CustomLogger.log("postalservice", `Updated ${actorsToUpdate.length} address books with actor ${newActorId}`);
      });
    }

    CustomLogger.log("postalservice", `Updated ${actorsToUpdate.length} address books with actor ${newActorId}`);
    return Promise.resolve();
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

      // Update address books for all actors but skip further proxy creation to avoid recursion
      this.updateAddressBooks(actorId as ToAddress, undefined, true);

    } catch (error: unknown) {
      console.error("postalservice", `Failed to create proxy for remote actor ${actorId}:`, error);
      throw new Error(`Failed to create proxy for remote actor ${actorId}: ${error instanceof Error ? error.message : String(error)}`);
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
    if (!actor.worker || typeof (actor.worker as any).getIrohAddr !== 'function') {
      console.log("postalservice", `Cannot create proxy for actor ${actorId}: worker or getIrohAddr method not available`);
      return;
    }

    try {
      // Get the nodeId
      const irohAddr = await (actor.worker as any).getIrohAddr();
      if (!irohAddr || !irohAddr.nodeId) {
        console.log("postalservice", `Cannot create proxy for actor ${actorId}: nodeId not available`);
        return;
      }

      const nodeId = irohAddr.nodeId;
      console.log("postalservice", `Creating test proxy for local actor ${actorId} with nodeId ${nodeId}`);

      // Save topics
      const existingTopics = actor.topics;

      // Create proxy but don't trigger another round of proxy creation
      this.createProxyActor(actorId as string, nodeId);

      // Restore topics
      const newActor = PostalService.actors.get(actorId);
      if (newActor) {
        existingTopics.forEach(topic => newActor.topics.add(topic));
      }

      console.log("postalservice", `Successfully created test proxy for actor ${actorId}`);
    } catch (error: unknown) {
      console.error("postalservice", `Failed to create test proxy for actor ${actorId}:`, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
