import { Signal } from "./utils.ts";
import {
  actorState,
  type GenericActorFunctions,
  type tsfile,
  type BaseState,
  type TargetMessage,
  type Message,
  System,
  type ToAddress,
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";

const xstate = actorState({
  name: "",
  id: "",
  addressBook: new Set(),
  topics: new Set(),
});

export class PostMan {
  private static addressBook: Set<string>;
  private static functions = functions as GenericActorFunctions
  static worker: Worker = self as unknown as Worker;
  static state: BaseState;

  constructor(
    actorState: Record<string, any>,
    functions: GenericActorFunctions,
  ) {
    // Initialize PostMan state
    PostMan.state = xstate;
    PostMan.state.name = actorState.name;
    PostMan.addressBook = PostMan.state.addressBook;
    
    // Merge actor state with PostMan state if provided
    if (actorState) {
      PostMan.state = { ...PostMan.state, ...actorState };
    }
    
    // Merge functions
    PostMan.functions = { ...PostMan.functions, ...functions };
    
    // Set up message handler
    PostMan.worker.onmessage = (event: MessageEvent) => {
      runFunctions(event.data, PostMan.functions, PostMan)
    };
  }

  static async create(actorname: tsfile | URL, base?: tsfile | URL): Promise<ToAddress> {
    //console.log("create", actorname)
    interface payload {
      actorname: tsfile | URL;
      base?: tsfile | URL
    }
    let payload: payload
    if (base) {
      payload = { actorname, base }
    }
    else {
      payload = {actorname}
    }
    const result = await PostMan.PostMessage({
      target: System,
      type: "CREATE",
      payload: payload
    }, true) as ToAddress

    PostMan.addressBook.add(result)
    return result;
  }

  static setTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "SET_TOPIC",
      payload: topic
    })
    PostMan.state.topics.add(topic)
  }

  static delTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "DEL_TOPIC",
      payload: topic
    })
    PostMan.state.topics.delete(topic)
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
