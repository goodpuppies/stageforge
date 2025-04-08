import {
  type GenericActorFunctions,
  type tsfile,
  type BaseState,
  type TargetMessage,
  type Message,
  System,
  type ActorId,
  type ActorInit,
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";

export class PostMan {
  private static addressBook: Set<ActorId>;
  private static functions = functions as GenericActorFunctions
  static worker: Worker = self as unknown as Worker;
  static state: BaseState;

  constructor(
    actorState: ActorInit,
    functions: GenericActorFunctions,
  ) {
    // Check that required properties exist
    if (!actorState.name) {
      throw new Error("Actor state must have a name property");
    }
    
    // Initialize with system properties
    const systemProps = {
      id: "" as ActorId, // Will be set properly during INIT
      addressBook: new Set<ActorId>(),
    };
    
    // Create a single state object with both system and actor properties
    // This ensures both actorState and PostMan.state reference the same object
    Object.assign(actorState, systemProps);
    
    // Set PostMan.state to reference the actor's state object
    // Use type assertion to make TypeScript recognize all properties
    PostMan.state = actorState as BaseState;
    PostMan.addressBook = PostMan.state.addressBook;
    
    // Merge functions
    PostMan.functions = { ...PostMan.functions, ...functions };
    
    // Set up message handler
    PostMan.worker.onmessage = (event: MessageEvent) => {
      runFunctions(event.data, PostMan.functions, PostMan)
    };
  }

  static async create(actorname: tsfile | URL): Promise<ActorId> {
    const result = await PostMan.PostMessage({
      target: System,
      type: "CREATE",
      payload: actorname
    }, true) as ActorId

    PostMan.addressBook.add(result)
    return result;
  }

  static PostMessage(
    message: TargetMessage | Message,
    cb: true
  ): Promise<unknown>;
  static PostMessage(
    message: TargetMessage | Message,
    cb?: false
  ): void;
  static async PostMessage(
    message: TargetMessage | Message,
    cb?: boolean
  ): Promise<unknown | void> {
    return await PostMessage(message, cb, this);
  }
}
