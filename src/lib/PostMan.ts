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
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { assert } from "@goodpuppies/logicalassert";

export class PostMan {
  private static addressBook: Set<ActorId>;
  private static functions = functions as GenericActorFunctions;
  static worker: Worker = self as unknown as Worker;
  private static state: BaseState;
  private static sender?: ActorId;

  constructor(
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
  ): Promise<ActorId> {
    console.log("create", file);
    interface payload {
      file: tsfile | URL;
      base?: tsfile | URL;
    }
    const payload = assert({ file, base }).with({
      base: {
        condition: { file: "string", base: "string" },
        exec: (val: { file: string; base: string }) => {
          return { file: val.file, base: val.base };
        },
      },
      actorOnly: {
        condition: { file: "string", base: "undefined" },
        exec: (val: { file: string }) => {
          return { file: val.file };
        },
      },
    });
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
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  static PostMessage<
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  // Implementation
  static PostMessage<
    T extends Record<string, (payload: any, ctx?: any) => any>,
  >(message: MessageFrom<T>, cb?: boolean): any {
    return PostMessage(message as any, cb, this);
  }
}
