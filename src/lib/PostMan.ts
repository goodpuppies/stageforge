import {
  type GenericActorFunctions,
  type tsfile,
  type BaseState,
  type MessageFrom,
  type ReturnFrom,
  System,
  type ActorId,
  createTopicName
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";

export class PostMan {
  private static addressBook: Set<ActorId>;
  private static functions = functions as GenericActorFunctions
  static worker: Worker = self as unknown as Worker;
  private static state: BaseState;

  constructor(
    actorState: Record<string, any> & BaseState,
    functions: GenericActorFunctions,
  ) {
    PostMan.state = actorState;
    PostMan.state.name = actorState.name;
    PostMan.addressBook = actorState.addressBook;
    PostMan.functions = { ...PostMan.functions, ...functions };
    
    // Set up message handler
    PostMan.worker.onmessage = (event: MessageEvent) => {
      runFunctions(event.data, PostMan.functions, PostMan)
    };
  }


  static async create(actorname: tsfile | URL, base?: tsfile | URL): Promise<ActorId> {
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
    }, true) as ActorId

    PostMan.addressBook.add(result)
    return result;
  }

  static setTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "TOPICUPDATE",
      payload: {
        delete: false,
        name: topic
      }
    })
    PostMan.state.topics.add(createTopicName(topic))
  }
  static delTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "TOPICUPDATE",
      payload: {
        delete: true,
        name: topic
      }
    })
    PostMan.state.topics.delete(createTopicName(topic))
  }

  static PostMessage<
    T extends Record<string, (payload: any) => any>
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  static PostMessage<
    T extends Record<string, (payload: any) => any>
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  // Implementation
  static PostMessage<
    T extends Record<string, (payload: any) => any>
  >(message: MessageFrom<T>, cb?: boolean): any {
    return PostMessage(message as any, cb, this);
  }
}
