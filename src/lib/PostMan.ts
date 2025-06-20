import {
  type ActorId,
  type BaseState,
  createTopicName,
  type GenericActorFunctions,
  type Message,
  type MessageFrom,
  type ReturnFrom,
  System,
  type tsfile,
  type workerpayload,
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";

export class PostMan {
  private static addressBook: Set<ActorId>;
  private static functions = functions as GenericActorFunctions;
  static worker: Worker = self as unknown as Worker;
  private static state: BaseState;
  public static sender?: ActorId | typeof System;

  constructor(
    // deno-lint-ignore no-explicit-any
    actorState: Record<string, any> & BaseState,
    functions: GenericActorFunctions,
  ) {
    PostMan.state = actorState;
    PostMan.state.name = actorState.name;
    PostMan.addressBook = actorState.addressBook;
    PostMan.functions = { ...PostMan.functions, ...functions };
    PostMan.worker.onmessage = (event: MessageEvent) => {
      // awkward asf
      PostMan.sender = (event.data as Message).address.fm;
      runFunctions(event.data, PostMan.functions, PostMan);
    };
  }

  static async create(
    file: tsfile | URL,
    base?: tsfile | URL,
    parentOverride?: ActorId,
  ): Promise<ActorId> {
    let payload: workerpayload;
    if (base) {
      payload = { file: file, base: base, parent: parentOverride };
    } else {
      payload = { file: file, parent: parentOverride };
    }
    const result = await PostMan.PostMessage({
      target: System,
      type: "CREATE",
      payload: payload,
    }, true) as ActorId;

    PostMan.addressBook.add(result);
    return result;
  }

  static setTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "TOPICUPDATE",
      payload: {
        delete: false,
        name: topic,
      },
    });
    PostMan.state.topics.add(createTopicName(topic));
  }
  static delTopic(topic: string) {
    PostMan.PostMessage({
      target: System,
      type: "TOPICUPDATE",
      payload: {
        delete: true,
        name: topic,
      },
    });
    PostMan.state.topics.delete(createTopicName(topic));
  }

  static PostMessage<
    // deno-lint-ignore no-explicit-any
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  static PostMessage<
    // deno-lint-ignore no-explicit-any
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  // Implementation
  static PostMessage<
    // deno-lint-ignore no-explicit-any
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb?: boolean): unknown {
    return PostMessage(message, cb, this);
  }
}
