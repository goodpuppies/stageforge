import {
  type GenericActorFunctions,
  type tsfile,
  type BaseState,
  type MessageFrom,
  type ReturnFrom,
  System,
  type ActorId,
  ActorIdValue,
  type ActorRef,
  createTopicName,
  resolveActorId,
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";

function createActorRef<T extends GenericActorFunctions>(actorId: ActorId): ActorRef<T> {
  const ref = {
    [ActorIdValue]: actorId,
    toString: () => actorId,
    valueOf: () => actorId,
    [Symbol.toPrimitive]: () => actorId,
  };
  Object.defineProperty(ref, ActorIdValue, {
    value: actorId,
    enumerable: false,
  });

  return new Proxy(ref, {
    get(target, prop, receiver) {
      if (prop === ActorIdValue) {
        return actorId;
      }
      if (prop === "toString" || prop === "valueOf" || prop === Symbol.toPrimitive) {
        return () => actorId;
      }
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "then") {
        return undefined;
      }
      if (prop in target) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (prop in String.prototype) {
        const value = Reflect.get(String.prototype, prop, actorId);
        return typeof value === "function" ? value.bind(actorId) : value;
      }
      return (payload: unknown = null) =>
        PostMan.PostMessage({
          target: actorId,
          type: prop,
          payload,
        }, true);
    },
  }) as unknown as ActorRef<T>;
}

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


  static async create<T extends GenericActorFunctions = GenericActorFunctions>(
    actorname: tsfile | URL,
    base?: tsfile | URL,
  ): Promise<ActorRef<T>> {
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
    return createActorRef<T>(result);
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
    if ("target" in message) {
      const target = message.target;
      message = {
        ...message,
        target: Array.isArray(target)
          ? target.map((item) => resolveActorId(item))
          : resolveActorId(target),
      };
    }
    return PostMessage(message as any, cb, this);
  }
}
