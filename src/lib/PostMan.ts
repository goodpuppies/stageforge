import {
  type ActorId,
  ActorIdValue,
  type ActorRef,
  type BaseState,
  createTopicName,
  type GenericActorFunctions,
  type MessageFrom,
  resolveActorId,
  type ReturnFrom,
  System,
  type tsfile,
} from "./types.ts";
import { functions } from "./DefaultActorFunctions.ts";
import { PostMessage, runFunctions } from "./shared.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";

function createActorRef<T extends GenericActorFunctions>(
  actorId: ActorId,
): ActorRef<T> {
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
      if (
        prop === "toString" || prop === "valueOf" || prop === Symbol.toPrimitive
      ) {
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
  private static functions = functions as GenericActorFunctions;
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
    LogChannel.log("actorroute", {
      event: "postman-construct",
      actorName: actorState.name,
      availableFunctions: Object.keys(PostMan.functions),
    });

    // Set up message handler
    PostMan.worker.onmessage = (event: MessageEvent) => {
      // runFunctions already reports dispatch failures to the caller; this is the
      // last net so a rejection can never surface as an unhandled worker error.
      void runFunctions(event.data, PostMan.functions, PostMan).catch(
        (error: unknown) => {
          console.error(
            `[stageforge] unhandled dispatch error in ${actorState.name}:`,
            error,
          );
        },
      );
    };

    PostMan.installWorkerErrorGuards(actorState.name);
  }

  /**
   * Keep one bad async continuation from taking the process down.
   *
   * Actors host long-lived native resources (OpenVR, raylib, capture helpers),
   * so a stray rejection anywhere in the worker used to kill every actor at
   * once. Log loudly and keep running instead.
   */
  private static errorGuardsInstalled = false;
  private static installWorkerErrorGuards(actorName: string): void {
    if (PostMan.errorGuardsInstalled) return;
    PostMan.errorGuardsInstalled = true;
    const scope = globalThis as unknown as {
      addEventListener?: (
        type: string,
        listener: (event: any) => void,
      ) => void;
    };
    scope.addEventListener?.("unhandledrejection", (event: any) => {
      event.preventDefault?.();
      console.error(
        `[stageforge] unhandled rejection in actor ${actorName}:`,
        event?.reason,
      );
    });
    scope.addEventListener?.("error", (event: any) => {
      event.preventDefault?.();
      console.error(
        `[stageforge] uncaught error in actor ${actorName}:`,
        event?.error ?? event?.message,
      );
    });
  }

  static async create<T extends GenericActorFunctions = GenericActorFunctions>(
    actorname: tsfile | URL,
    base?: tsfile | URL,
  ): Promise<ActorRef<T>> {
    //console.log("create", actorname)
    interface payload {
      actorname: tsfile | URL;
      base?: tsfile | URL;
    }
    let payload: payload;
    if (base) {
      payload = { actorname, base };
    } else {
      payload = { actorname };
    }
    const result = await PostMan.PostMessage({
      target: System,
      type: "CREATE",
      payload: payload,
    }, true) as ActorId;
    LogChannel.log("actorroute", {
      event: "postman-create-result",
      requester: PostMan.state.id,
      actorname,
      base,
      result,
    });

    PostMan.addressBook.add(result);
    return createActorRef<T>(result);
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
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb: true): Promise<ReturnFrom<T, typeof message>>;
  static PostMessage<
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb?: false | undefined): void;
  // Implementation
  static PostMessage<
    T extends Record<string, (payload: any) => any>,
  >(message: MessageFrom<T>, cb?: boolean): any {
    if ("target" in message) {
      const target = message.target;
      message = {
        ...message,
        target: Array.isArray(target)
          ? target.map((item) => resolveActorId(item))
          : resolveActorId(target),
      };
      LogChannel.log("actorroute", {
        event: "postman-resolve-target",
        actor: PostMan.state?.id,
        type: message.type,
        resolvedTarget: message.target,
      });
    }
    return PostMessage(message as any, cb, this);
  }
}
