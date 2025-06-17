import {
  type GenericActorFunctions,
  type tsfile,
  type BaseState,
  type MessageFrom,
  type ReturnFrom,
  System,
  type ActorId,
  createTopicName,
  type Message,
  type proxy
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { assert } from "@goodpuppies/logicalassert";



export class PostMan {
  private static addressBook: Set<ActorId>;
  private static functions = functions as GenericActorFunctions
  static worker: Worker = self as unknown as Worker;
  private static state: BaseState;
  private static sender?: ActorId

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
      PostMan.sender = (event.data as Message).address.fm
      runFunctions(event.data, PostMan.functions, PostMan)
    };
  }


  static async create(address: tsfile | URL | typeof proxy, base?: tsfile | URL): Promise<ActorId> {
    console.log("create", address)
    interface payload {
      address: tsfile | URL;
      base?: tsfile | URL
    }

    
    const payload = assert({ address, base}).with({
      proxyActor: {
        condition:
          address === "PROXY" &&
          base === undefined,
        exec: (_val:unknown) => {
          return "PROXY"
        },
      },
      base: {
        condition: { address: 'string', base: 'string'},
        exec: (val: { address: string, base: string}) => {
          return { address: val.address, base: val.base };
        },
      },
      actorOnly: {
        condition: {address: 'string', base: 'undefined'},
        exec: (val:{address: string}) => {
          return { address: val.address };
        },
      },
    });
    
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
    T extends Record<string, (payload: any, ctx?: any) => any>
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  static PostMessage<
    T extends Record<string, (payload: any, ctx?: any) => any>
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  // Implementation
  static PostMessage<
    T extends Record<string, (payload: any, ctx?: any) => any>
  >(message: MessageFrom<T>, cb?: boolean): any {
    return PostMessage(message as any, cb, this);
  }
}
