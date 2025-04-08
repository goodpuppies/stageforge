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
});

export class PostMan {
  private static addressBook: Set<string>;
  private static functions = functions as GenericActorFunctions
  static worker: Worker = self as unknown as Worker;
  static state: BaseState;

  constructor(
    name: string,
    functions: GenericActorFunctions
  ) {
    PostMan.state = xstate;
    PostMan.state.name = name;
    PostMan.addressBook = PostMan.state.addressBook;
    PostMan.functions = { ...PostMan.functions, ...functions };
    PostMan.worker.onmessage = (event: MessageEvent) => {
      runFunctions(event.data, PostMan.functions, PostMan)
    };
  }

  static async create(actorname: tsfile | URL): Promise<ToAddress> {
    //console.log("create", actorname)
    const result = await PostMan.PostMessage({
      target: System,
      type: "CREATE",
      payload: actorname
    }, true) as ToAddress

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
