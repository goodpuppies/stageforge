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

interface PerfData {
  type: "MessageProcessed" | "PostalServiceSyncSend" | "PostalServiceAsyncSend";
  messageType: string; // Base message type e.g. "GETHMDPOSITION"
  from: string;
  to: string;
  durationMs: number;
  timestamp: number;
  system?: boolean;
  relay?: boolean;
}

export class PostalService {
  public static actors: Map<ActorId, ActorW> = new Map();
  public static lastSender: ActorId | null = null;
  public static debugMode = false;
  private static topicRegistry: Map<TopicName, Set<ActorId>> = new Map();
  private callbackMap: Map<symbol, Signal<any>> = new Map();
  private static WorkerClass: WorkerConstructor = Worker;
  private signalingClient: SignalingClient | null = null;
  private static mainInstance: PostalService | null = null;

  // Performance Metrics
  private static messageTimings: PerfData[] = [];
  private static readonly MAX_TIMINGS = 1000; // Store last 1000 timings
  private static _isPerfLoggingPhysicallyOn = false; // New internal state, off by default
  private static perfLogConsoleThresholdMs = 1.0; // Log to console if duration > this
  private static lastPerfSummaryTime = 0;
  private static readonly perfSummaryIntervalMs = 2000; // 2 seconds
  private static currentPeriodPerfData: PerfData[] = [];
  private static perfSummaryTimer: number | null = null; // Deno returns number for setInterval

  // New getter/setter for performance logging
  public static get performanceLoggingActive(): boolean {
    return PostalService._isPerfLoggingPhysicallyOn;
  }

  public static set performanceLoggingActive(enabled: boolean) {
    PostalService._isPerfLoggingPhysicallyOn = enabled; // Set the internal state

    if (enabled) {
      LogChannel.log("postalservice", "Performance logging ENABLED.");
      if (PostalService.perfSummaryTimer === null) {
        PostalService.lastPerfSummaryTime = performance.now();
        PostalService.currentPeriodPerfData = []; 
        PostalService.perfSummaryTimer = setInterval(
          PostalService.logPerfSummary,
          PostalService.perfSummaryIntervalMs
        ) as unknown as number; 
        LogChannel.log("postalservice", `Perf summary timer STARTED with interval ${PostalService.perfSummaryIntervalMs}ms.`);
      } else {
        LogChannel.log("postalservice", "Perf summary timer was already running.");
      }
    } else { 
      LogChannel.log("postalservice", "Performance logging DISABLED.");
      if (PostalService.perfSummaryTimer !== null) {
        clearInterval(PostalService.perfSummaryTimer);
        PostalService.perfSummaryTimer = null;
        LogChannel.log("postalservice", "Perf summary timer STOPPED.");
        if (PostalService.currentPeriodPerfData.length > 0) {
          LogChannel.log("postalservice", "Logging final performance summary data...");
          PostalService.logPerfSummary(); 
        }
      }
    }
  }

  // Constructor that accepts a custom Worker implementation
  constructor(customWorkerClass?: WorkerConstructor) {
    PostalService.mainInstance = this;
    if (customWorkerClass) {
      PostalService.WorkerClass = customWorkerClass;
      LogChannel.log("postalservice", "Using custom Worker implementation");
    }
  }

  // Method to get and clear performance stats
  public static getPerfStats() {
    const stats = [...PostalService.messageTimings];
    PostalService.messageTimings = [];
    return stats;
  }

  private static logPerfSummary(): void {
    const now = performance.now();
    const actualIntervalMs = now - PostalService.lastPerfSummaryTime;
    const pendingRepliesCount = PostalService.mainInstance ? PostalService.mainInstance.callbackMap.size : 0;

    const dataToSummarize = [...PostalService.currentPeriodPerfData];
    PostalService.currentPeriodPerfData = []; // Clear for the next interval

    if (dataToSummarize.length === 0) {
      LogChannel.log("postalperfsummary", {
        intervalMs: parseFloat(actualIntervalMs.toFixed(3)),
        totalMessages: 0,
        totalProcessingTimeMs: 0,
        avgProcessingTimeMs: 0,
        minProcessingTimeMs: 0,
        maxProcessingTimeMs: 0,
        p95ProcessingTimeMs: 0,
        pendingRepliesCount: pendingRepliesCount,
        mostFrequentMessageType: "N/A",
        mostFrequentMessageCount: 0,
        mostTimeConsumingMessageType: "N/A",
        totalTimeForMostConsumingTypeMs: 0,
      });
      PostalService.lastPerfSummaryTime = now;
      return;
    }

    const numMessages = dataToSummarize.length;
    let totalDurationMs = 0;
    const typeCounts: Record<string, number> = {};
    const typeDurations: Record<string, number> = {};
    let minDurationMs = Infinity;
    let maxDurationMs = 0;
    const allDurations: number[] = [];

    for (const entry of dataToSummarize) {
      totalDurationMs += entry.durationMs;
      typeCounts[entry.messageType] = (typeCounts[entry.messageType] || 0) + 1;
      typeDurations[entry.messageType] = (typeDurations[entry.messageType] || 0) + entry.durationMs;
      minDurationMs = Math.min(minDurationMs, entry.durationMs);
      maxDurationMs = Math.max(maxDurationMs, entry.durationMs);
      allDurations.push(entry.durationMs);
    }

    const avgDurationMs = totalDurationMs / numMessages;

    allDurations.sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(numMessages * 0.95) - 1, numMessages - 1);
    const p95DurationMs = allDurations[p95Index];

    let mostFrequentMessageType = "N/A";
    let mostFrequentMessageCount = 0;
    for (const type in typeCounts) {
      if (typeCounts[type] > mostFrequentMessageCount) {
        mostFrequentMessageCount = typeCounts[type];
        mostFrequentMessageType = type;
      }
    }

    let mostTimeConsumingMessageType = "N/A";
    let totalTimeForMostConsumingTypeMs = 0;
    for (const type in typeDurations) {
      if (typeDurations[type] > totalTimeForMostConsumingTypeMs) {
        totalTimeForMostConsumingTypeMs = typeDurations[type];
        mostTimeConsumingMessageType = type;
      }
    }

    LogChannel.log("postalperfsummary", {
      intervalMs: parseFloat(actualIntervalMs.toFixed(3)),
      totalMessages: numMessages,
      totalProcessingTimeMs: parseFloat(totalDurationMs.toFixed(3)),
      avgProcessingTimeMs: parseFloat(avgDurationMs.toFixed(3)),
      minProcessingTimeMs: parseFloat(minDurationMs.toFixed(3)),
      maxProcessingTimeMs: parseFloat(maxDurationMs.toFixed(3)),
      p95ProcessingTimeMs: parseFloat(p95DurationMs.toFixed(3)),
      pendingRepliesCount: pendingRepliesCount,
      mostFrequentMessageType,
      mostFrequentMessageCount,
      mostTimeConsumingMessageType,
      totalTimeForMostConsumingTypeMs: parseFloat(totalTimeForMostConsumingTypeMs.toFixed(3)),
    });

    PostalService.lastPerfSummaryTime = now;
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

  OnMessage = async (message: Message): Promise<void> => { 
    const messageStartTime = PostalService._isPerfLoggingPhysicallyOn ? performance.now() : 0;
    let isSystemMessage = false;
    let isRelay = false;
    let processingTimeMs = 0;

    // Store original sender for logging before it's potentially modified by runFunctions
    const originalSender = message.address.fm; 
    PostalService.lastSender = originalSender; // Keep this for TOPICUPDATE logic

    LogChannel.log("postalserviceOnMessage", "postalService handleMessage", message);
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];
    
    for (const address of addresses) {
      const singleMessageStartTime = PostalService._isPerfLoggingPhysicallyOn ? performance.now() : 0;
      // Create a shallow copy for modification to avoid altering the original message object for subsequent loops/logs
      const currentMessage = { ...message, address: { ...message.address, to: address } };

      if (currentMessage.address.to === System) {
        isSystemMessage = true;
        await runFunctions(currentMessage, this.functions, this); 
      } else {
        isRelay = true;
        const actor = PostalService.actors.get(currentMessage.address.to as ActorId);
        if (actor) {
          actor.worker.postMessage(currentMessage);
        } else {
          LogChannel.log("postalservice", "Error: Actor not found for message relay:", currentMessage.address.to);
        }
      }

      if (PostalService._isPerfLoggingPhysicallyOn) {
        const singleMessageEndTime = performance.now();
        processingTimeMs = singleMessageEndTime - singleMessageStartTime;
        
        if (PostalService.messageTimings.length >= PostalService.MAX_TIMINGS) {
          PostalService.messageTimings.shift(); 
        }
        const perfEntry: PerfData = {
          type: "MessageProcessed",
          messageType: currentMessage.type.split(":")[0], 
          from: originalSender,
          to: currentMessage.address.to,
          durationMs: parseFloat(processingTimeMs.toFixed(3)),
          timestamp: Date.now(),
          system: isSystemMessage,
          relay: isRelay
        };
        PostalService.messageTimings.push(perfEntry);
        PostalService.currentPeriodPerfData.push(perfEntry);
        if (processingTimeMs > PostalService.perfLogConsoleThresholdMs) {
          LogChannel.log("postalperf", perfEntry);
        }
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
      const perfLogStartTime = PostalService._isPerfLoggingPhysicallyOn ? performance.now() : 0;
      const actualTarget = message.target; // or however target is determined
      const actor = PostalService.actors.get(actualTarget as ActorId);

      if (actor) {
        if (cb && typeof PostMessage === 'function') { 
           const result = PostMessage(message as any, true, this); 
           if (PostalService._isPerfLoggingPhysicallyOn) {
              const perfLogEndTime = performance.now();
              const duration = parseFloat((perfLogEndTime - perfLogStartTime).toFixed(3));
              const perfEntry: PerfData = {
                type: "PostalServiceSyncSend",
                messageType: message.type.split(":")[0],
                from: message.address.fm,
                to: actualTarget,
                durationMs: duration,
                timestamp: Date.now(),
              };
              PostalService.messageTimings.push(perfEntry);
              if (PostalService.messageTimings.length > PostalService.MAX_TIMINGS) {
                PostalService.messageTimings.shift(); 
              }
              PostalService.currentPeriodPerfData.push(perfEntry);
              if (duration > PostalService.perfLogConsoleThresholdMs) {
                LogChannel.log("postalperf", perfEntry);
              }
           }
           return result;
        } else {
          actor.worker.postMessage(message);
          if (PostalService._isPerfLoggingPhysicallyOn) {
              const perfLogEndTime = performance.now();
              const duration = parseFloat((perfLogEndTime - perfLogStartTime).toFixed(3));
              const perfEntry: PerfData = {
                type: "PostalServiceAsyncSend",
                messageType: message.type.split(":")[0],
                from: message.target,
                to: actualTarget,
                durationMs: duration,
                timestamp: Date.now(),
              };
              PostalService.messageTimings.push(perfEntry);
              if (PostalService.messageTimings.length > PostalService.MAX_TIMINGS) {
                PostalService.messageTimings.shift();
              }
              PostalService.currentPeriodPerfData.push(perfEntry);
              if (duration > PostalService.perfLogConsoleThresholdMs) {
                LogChannel.log("postalperf", perfEntry);
              }
          }
        }
      } else {
        LogChannel.log("postalservice", "Error: Actor not found for PostalService.PostMessage:", actualTarget);
        if (cb) return Promise.reject(new Error(`Actor not found: ${actualTarget}`)); 
      }
    }

  //#endregion
  private doTopicUpdate(
    topicSet: Set<ActorId>,
    updater: ActorId,
    delmode: boolean
  ) {
    if (PostalService.debugMode) {
      return;
    }
    for (const actorId of topicSet) {
      if (actorId === updater) continue;
      const type = delmode ? "REMOVECONTACT" : "ADDCONTACT";
      this.PostMessage({ target: actorId, type, payload: updater });
      this.PostMessage({ target: updater, type, payload: actorId });
    }
  }

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
      if (remoteNodeId && !PostalService.actors.has(remoteActorId)) {
        LogChannel.log(
          "postalservice",
          `signaling: Creating proxy for remote actor ${remoteActorId}`
        );
        this.createProxyActor(remoteActorId, remoteNodeId, false);
        PostalService.topicRegistry.get(topic)?.add(remoteActorId);
      }
      PostalService.topicRegistry.get(topic)?.forEach( async (localActorId) => {
        if (localActorId === remoteActorId) return;
        this.PostMessage<typeof defaultActorApi>({
          target: localActorId, type: "ADDCONTACTNODE",
          payload: {
            actorId: remoteActorId,
            topic: topic,
            nodeid: remoteNodeId
          }
        });
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
