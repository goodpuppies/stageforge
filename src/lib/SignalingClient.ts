import { CustomLogger } from "../logger/customlogger.ts";
import { type ToAddress } from "./types.ts";

// Simple message types for the signaling server
interface SignalingMessage {
  type: "join" | "leave";
  actorId: string;
  topic: string;
  nodeId?: string;
}

/**
 * A simple client for interacting with the signaling server
 * Handles topic join/leave messages
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private messageQueue: SignalingMessage[] = [];
  private topicCallbacks = new Map<string, Set<(actorId: string, nodeId?: string) => void>>();
  
  /**
   * Create a new SignalingClient
   * @param serverUrl The WebSocket URL of the signaling server
   */
  constructor(private serverUrl: string) {}
  
  /**
   * Connect to the signaling server
   */
  connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.addEventListener("open", () => {
          CustomLogger.log("signaling", "Connected to signaling server");
          this.connected = true;
          
          // Send any queued messages
          this.messageQueue.forEach(msg => this.sendMessage(msg));
          this.messageQueue = [];
          
          resolve();
        });
        
        this.ws.addEventListener("message", (event) => {
          CustomLogger.log("signaling", "Received message");
          try {
            const data = JSON.parse(event.data) as SignalingMessage;
            this.handleMessage(data);
          } catch (error) {
            CustomLogger.log("signaling", "Error parsing message:", error);
          }
        });
        
        this.ws.addEventListener("close", () => {
          CustomLogger.log("signaling", "Disconnected from signaling server");
          this.connected = false;
          this.ws = null;
        });
        
        this.ws.addEventListener("error", (error) => {
          CustomLogger.log("signaling", "WebSocket error:", error);
          reject(error);
        });
      } catch (error) {
        CustomLogger.log("signaling", "Error connecting to signaling server:", error);
        reject(error);
      }
    });
  }
  
  /**
   * Join a topic
   * @param actorId The ID of the actor joining the topic
   * @param topic The topic to join
   * @param nodeId Optional Iroh node ID
   */
  joinTopic(actorId: ToAddress, topic: string, nodeId?: string): void {
    const message: SignalingMessage = {
      type: "join",
      actorId: actorId,
      topic,
      nodeId
    };
    
    if (!this.connected) {
      this.messageQueue.push(message);
      this.connect().catch(error => {
        CustomLogger.log("signaling", "Failed to connect to signaling server:", error);
      });
      return;
    }
    
    this.sendMessage(message);
  }
  
  /**
   * Leave a topic
   * @param actorId The ID of the actor leaving the topic
   * @param topic The topic to leave
   */
  leaveTopic(actorId: ToAddress, topic: string): void {
    const message: SignalingMessage = {
      type: "leave",
      actorId: actorId,
      topic
    };
    
    if (!this.connected) {
      this.messageQueue.push(message);
      this.connect().catch(error => {
        CustomLogger.log("signaling", "Failed to connect to signaling server:", error);
      });
      return;
    }
    
    this.sendMessage(message);
  }
  
  /**
   * Register a callback for when an actor joins a topic
   * @param topic The topic to watch
   * @param callback The callback to call when an actor joins
   */
  onJoinTopic(topic: string, callback: (actorId: string, nodeId?: string) => void): void {
    if (!this.topicCallbacks.has(topic)) {
      this.topicCallbacks.set(topic, new Set());
    }
    
    this.topicCallbacks.get(topic)!.add(callback);
  }
  
  /**
   * Close the connection to the signaling server
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
  
  /**
   * Send a message to the signaling server
   */
  private sendMessage(message: SignalingMessage): void {
    CustomLogger.log("signaling", "Sending message:", message);
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }
  
  /**
   * Handle a message from the signaling server
   */
  private handleMessage(message: SignalingMessage): void {
    if (message.type === "join") {
      // An actor joined a topic
      CustomLogger.log("signaling", `Actor ${message.actorId} joined topic ${message.topic}`);
      
      // Call any callbacks for this topic
      const callbacks = this.topicCallbacks.get(message.topic);
      if (callbacks) {
        callbacks.forEach(callback => callback(message.actorId, message.nodeId));
      }
    } else if (message.type === "leave") {
      // An actor left a topic
      CustomLogger.log("signaling", `Actor ${message.actorId} left topic ${message.topic}`);
    }
  }
}
