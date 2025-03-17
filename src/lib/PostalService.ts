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
        CustomLogger.log("CB", payload);
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
      try {
        const topic = payload;
        // The actor ID is the sender of the message BAD CODE
        const actorId = PostalService.lastSender as ToAddress;
        if (!actorId) {
          console.error("postalservice", "Cannot set topic: sender ID unknown");
          return;
        }
        
        const actor = PostalService.actors.get(actorId);
        if (!actor) {
          console.error("postalservice", `Cannot set topic: actor ${actorId} not found`);
          return;
        }

        // Skip if the actor is already in this topic
        if (actor.topics.has(topic)) {
          CustomLogger.log("postalservice", `Actor ${actorId} already subscribed to topic: ${topic}`);
          return;
        }
        
        // Add the topic to the actor's topic set
        actor.topics.add(topic);
        CustomLogger.log("postalservice", `Actor ${actorId} subscribed to topic: ${topic}`);

        // Get the nodeId if this is an IrohWebWorker - with safe error handling
        let nodeId: string | undefined;
        try {
          const info = await this.getActorRemoteInfo(actorId);
          nodeId = info.nodeId;
        } catch (error) {
          CustomLogger.log("postalservice", `Could not get remote info for actor ${actorId}, continuing without nodeId:`, error);
          // Continue without nodeId
        }

        // Register with the signaling server if available
        if (this.signalingClient) {
          try {
            // Join the topic on the signaling server
            this.signalingClient.joinTopic(actorId, topic, nodeId);

            //Start listening on the topic
            this.signalingClient.onJoinTopic(topic, (remoteActorId, remoteNodeId) => {
              try {
                // Only handle remote actors that aren't already in our system
                if (remoteNodeId && !PostalService.actors.has(remoteActorId as ToAddress)) {
                  
                  // Handle the remote actor joining the topic
                  try {
                    this.handleActorJoinTopic(topic, remoteActorId, remoteNodeId, actorId);
                  } catch (joinError: unknown) {
                    console.error("postalservice", `Error in handleActorJoinTopic for remote actor ${remoteActorId}:`, joinError);
                  }
                  
                } 
                // Handle local actors from the same process in debug mode
                else if (PostalService.debugMode && PostalService.actors.has(remoteActorId as ToAddress) && remoteActorId !== actorId) {
                  try {
                    this.handleActorJoinTopic(topic, remoteActorId, undefined, actorId);
                  } catch (joinError: unknown) {
                    console.error("postalservice", `Error in handleActorJoinTopic for local actor ${remoteActorId}:`, joinError);
                  }
                }
              } catch (callbackError: unknown) {
                console.error("postalservice", `Error in onJoinTopic callback:`, callbackError);
              }
            });

            CustomLogger.log("postalservice", `Registered actor ${actorId} with signaling server for topic ${topic}`);
          } catch (error) {
            console.error("postalservice", `Failed to register with signaling server:`, error);
          }
        } else {
          console.warn("postalservice", "Signaling client not initialized, topic-based discovery will not work");
        }
      } catch (error) {
        console.error("postalservice", `Unhandled error in SET_TOPIC:`, error);
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

  //#endregion

  /**
   * Check if an actor is remote and optionally get its nodeId
   * @param actorId The ID of the actor to check
   * @param fetchNodeId If true, will also fetch the nodeId if available
   * @returns An object with isRemote flag and optional nodeId
   */
  private async getActorRemoteInfo(actorId: ToAddress, fetchNodeId: boolean = true): Promise<{isRemote: boolean, nodeId?: string}> {
    const actor = PostalService.actors.get(actorId);
    if (!actor) return { isRemote: false };
    
    let isRemote = false;
    let nodeId: string | undefined = undefined;
    
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
          CustomLogger.log("postalservice", `No nodeId available for actor ${actorId}`);
        }
      } catch (error) {
        console.error("postalservice", `Failed to get nodeId for actor ${actorId}:`, error);
      }
    }
    
    return { isRemote, nodeId };
  }

  /**
   * Create a proxy actor for a remote or local actor
   * @param actorId The ID of the actor to create a proxy for
   * @param nodeId The node ID for remote actors, will be fetched from the actor for local proxies in debug mode
   * @param skipAddressBookUpdate If true, skip updating address books to avoid recursion
   */
  private async createProxyActor(actorId: string, nodeId?: string, skipAddressBookUpdate: boolean = false): Promise<void> {
    try {
      // Skip if we're attempting to handle a local actor proxy and we're not in debug mode
      if (!nodeId && !PostalService.debugMode) {
        CustomLogger.log("postalservice", `Skipping proxy creation for actor ${actorId} - not in debug mode and no nodeId provided`);
        return;
      }
      
      // Local actor handling - get nodeId if needed
      if (!nodeId && PostalService.debugMode) {
        // Skip if actor doesn't exist
        if (!PostalService.actors.has(actorId as ToAddress)) {
          CustomLogger.log("postalservice", `Cannot create proxy for actor ${actorId}: actor does not exist`);
          return;
        }
        
        const actor = PostalService.actors.get(actorId as ToAddress);
        if (!actor) {
          CustomLogger.log("postalservice", `Cannot create proxy for actor ${actorId}: actor reference is null`);
          return;
        }
        
        // Prevent infinite recursion with a flag
        if ((actor as any)._proxyCreated) {
          CustomLogger.log("postalservice", `Skipping proxy creation for actor ${actorId}: proxy already created`);
          return;
        }
        
        // Mark this actor as processed
        (actor as any)._proxyCreated = true;
        
        // Skip if we can't get nodeId
        if (!actor.worker || typeof (actor.worker as any).getIrohAddr !== 'function') {
          CustomLogger.log("postalservice", `Cannot create proxy for actor ${actorId}: worker or getIrohAddr method not available`);
          return;
        }
        
        try {
          // Get the nodeId for local actor - safely with try/catch
          let irohAddr;
          try {
            irohAddr = await (actor.worker as any).getIrohAddr();
          } catch (_initError) {
            CustomLogger.log("postalservice", `Cannot create proxy for actor ${actorId}: worker node not initialized`);
            return;
          }
          
          if (!irohAddr || !irohAddr.nodeId) {
            CustomLogger.log("postalservice", `Cannot create proxy for actor ${actorId}: nodeId not available`);
            return;
          }
          
          nodeId = irohAddr.nodeId;
          CustomLogger.log("postalservice", `Creating test proxy for local actor ${actorId} in debug mode`);
        } catch (error) {
          console.error("postalservice", `Failed to get nodeId for local actor ${actorId}:`, error);
          return;
        }
      }
      
      // Now we have a nodeId, either from the parameter (remote actor) or from the local actor
      
      // Save existing topics if the actor already exists
      let existingTopics = new Set<string>();
      if (PostalService.actors.has(actorId as ToAddress)) {
        const existingActor = PostalService.actors.get(actorId as ToAddress);
        if (existingActor) {
          existingTopics = existingActor.topics;
          CustomLogger.log("postalservice", `Replacing existing actor ${actorId} with proxy`);
        }
      }

      CustomLogger.log("postalservice", `Creating proxy for actor ${actorId}`);

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

        CustomLogger.log("postalservice", `Successfully created proxy for actor ${actorId}`);

        // Update address books for all actors but skip further proxy creation to avoid recursion
        if (!skipAddressBookUpdate) {
          await this.updateAddressBooks(actorId as ToAddress, undefined, true);
        }
      } catch (error) {
        console.error("postalservice", `Failed to create proxy worker for actor ${actorId}:`, error);
        return;
      }
    } catch (error) {
      CustomLogger.log("postalservice", `Exception in createProxyActor for actor ${actorId}:`, error);
      // Don't rethrow the error, just log it and return
    }
  }

  /**
   * Update address books for all actors when a new actor is added or joins a topic
   * @param newActorId The ID of the actor to add to address books
   * @param topic Optional topic - if provided, only update actors in this topic
   * @param skipProxyCreation If true, skip creating proxies to avoid recursive calls
   */
  private async updateAddressBooks(newActorId: ToAddress, topic?: string, skipProxyCreation: boolean = false): Promise<void> {
    try {
      CustomLogger.log("postalservice", `Updating address books for actor ${newActorId}${topic ? ` in topic ${topic}` : ''}`);

      const info = await this.getActorRemoteInfo(newActorId, false);
      const isNewActorRemote = info.isRemote;

      const actorsToUpdate: ToAddress[] = [];
      
      // Keep track of which actors we've already processed to avoid duplicates
      const processedPairs = new Set<string>();
      
      // Get the new actor to check its topics
      const newActor = PostalService.actors.get(newActorId);
      const newActorTopics = newActor ? Array.from(newActor.topics) : [];
      
      CustomLogger.log("postalservice", `Actor ${newActorId} has topics: [${newActorTopics.join(', ')}]`);

      // Find all actors that should be updated
      PostalService.actors.forEach(async (actor, actorId) => {
        try {
          if (actorId === newActorId) return; // Skip the new actor itself

          const actorTopics = Array.from(actor.topics);
          
          // Determine if actors should be updated based on topics
          let shouldUpdate = false;
          let _updateReason = ""; // Renamed with underscore as it's used only for debugging
          
          if (topic) {
            // If a specific topic is provided, only include actors in that topic
            shouldUpdate = actor.topics.has(topic);
            _updateReason = shouldUpdate ? 
              `Actor ${actorId} is in the specified topic ${topic}` : 
              `Actor ${actorId} is NOT in the specified topic ${topic}`;
          } else {
            // Check if actors share any topics - ALWAYS enforce topic boundaries
            const sharedTopics = actorTopics.filter(t => newActorTopics.includes(t));
            
            if (sharedTopics.length > 0) {
              shouldUpdate = true;
              _updateReason = `Actor ${actorId} shares topics with ${newActorId}: [${sharedTopics.join(', ')}]`;
            } else {
              shouldUpdate = false;
              _updateReason = `Actor ${actorId} does not share any topics with ${newActorId}`;
            }
          }
          
          // Debug logging to help understand what's happening
          //CustomLogger.log("postalservice", `Should update ${actorId}? ${shouldUpdate}. Reason: ${_updateReason}`);
          
          // Skip actors that don't meet our update criteria
          if (!shouldUpdate) {
            return;
          }

          // Create a unique key for this actor pair to track if we've processed it
          const pairKey = `${actorId}-${newActorId}`;
          const reversePairKey = `${newActorId}-${actorId}`;
          
          // Skip if we've already processed this pair
          if (processedPairs.has(pairKey) || processedPairs.has(reversePairKey)) {
            CustomLogger.log("postalservice", `Skipping duplicate update for actors ${actorId} and ${newActorId}`);
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
            try {
              // Wrap entire remote actor handling in a try/catch
              const existingActor = PostalService.actors.get(actorId);
              if (!existingActor) return;
              
              // Check if the worker exists and has getIrohAddr method
              if (!existingActor.worker) {
                CustomLogger.log("postalservice", `Actor ${actorId} has no worker, skipping remote contact`);
                return;
              }
              
              if (typeof (existingActor.worker as any).getIrohAddr !== 'function') {
                CustomLogger.log("postalservice", `Actor ${actorId} doesn't have getIrohAddr method, skipping remote contact`);
                return;
              }
              
              // Safely get the address with specific error handling
              let irohAddr;
              try {
                irohAddr = (existingActor.worker as any).getIrohAddr();
              } catch (_initError) {
                CustomLogger.log("postalservice", `Actor ${actorId}'s worker node not fully initialized yet, skipping remote contact`);
                return;
              }
              
              if (!irohAddr || !irohAddr.nodeId) {
                CustomLogger.log("postalservice", `Actor ${actorId} has no nodeId available, skipping remote contact`);
                return;
              }

              this.PostMessage({
                target: newActorId,
                type: "ADDCONTACTNODE",
                payload: {
                  address: actorId,
                  nodeid: irohAddr.nodeId
                }
              });
            } catch (remoteError: unknown) {
              CustomLogger.log("postalservice", `Error handling remote actor communication:`, remoteError);
            }
          }

          // Check if we need to create a proxy for the existing actor
          // Only do this if we're not in a recursive proxy creation call
          if (!skipProxyCreation && PostalService.debugMode && actor.topics.size > 0) {
            // This was a source of errors, so wrap in try-catch
            try {
              // Use await inside try/catch instead of .catch() to properly handle the error
              await this.createProxyActor(actorId as string);
            } catch (proxyError: unknown) {
              CustomLogger.log("postalservice", `Error attempting to create proxy for ${actorId}:`, proxyError);
            }
          }
        } catch (actorError: unknown) {
          CustomLogger.log("postalservice", `Error processing actor ${actorId}:`, actorError);
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

      CustomLogger.log("postalservice", `Updated ${actorsToUpdate.length} address books with actor ${newActorId}`);
    } catch (error: unknown) {
      CustomLogger.log("postalservice", `Error in updateAddressBooks for actor ${newActorId}:`, error);
    }
  }

  /**
   * Handle an actor joining a topic - works for both remote and local actors
   * @param topic The topic that was joined
   * @param joinedActorId The ID of the actor that joined (remote or local)
   * @param joinedNodeId The nodeId of the actor that joined (only for remote actors)
   * @param localActorId The ID of the local actor that owns the topic
   */
  private handleActorJoinTopic(topic: string, joinedActorId: string, joinedNodeId: string | undefined, localActorId: ToAddress): void {
    const isLocalActor = PostalService.actors.has(joinedActorId as ToAddress) && !joinedNodeId;
    
    CustomLogger.log("postalservice", `Handling ${isLocalActor ? 'local' : 'remote'} actor ${joinedActorId} joining topic ${topic}`);
    
    // For remote actors, we need to create a proxy first
    if (!isLocalActor && joinedNodeId) {
      // Create the proxy actor for remote actors
      this.createProxyActor(joinedActorId, joinedNodeId);
      
      // Then add the topic to the actor after creation
      const newActor = PostalService.actors.get(joinedActorId as ToAddress);
      if (!newActor) return;
      
      newActor.topics.add(topic);
      CustomLogger.log("postalservice", `Added topic ${topic} to remote actor ${joinedActorId}`);
    }
    
    // For both local and remote actors, establish direct contact
    // First make sure both actors are in each other's address books
    this.PostMessage({
      target: joinedActorId,
      type: "ADDCONTACT",
      payload: localActorId
    });
    
    this.PostMessage({
      target: localActorId,
      type: "ADDCONTACT",
      payload: joinedActorId
    });
    
    // Then update address books to connect actors bidirectionally
    this.updateAddressBooks(joinedActorId as ToAddress, topic, isLocalActor ? false : true);
    this.updateAddressBooks(localActorId, topic);
    
  }
}
