import { PostMan } from "./PostMan.ts";
import {
  type ActorId,
  createActorId,
  System,
  type TopicName,
} from "./types.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";

//default actor functions

function internalPostMan() {
  return PostMan as unknown as {
    state: {
      id: ActorId;
      name: string;
      addressBook: Set<ActorId>;
    };
    functions: {
      __INIT__?: (payload: unknown, actorId: ActorId) => void;
      __SHUTDOWN__?: (
        payload: unknown,
        actorId: ActorId,
      ) => unknown | Promise<unknown>;
      __HEALTH__?: (
        payload: unknown,
        actorId: ActorId,
      ) => unknown | Promise<unknown>;
      __SNAPSHOT__?: (
        payload: unknown,
        actorId: ActorId,
      ) => unknown | Promise<unknown>;
      __RESTORE__?: (
        payload: unknown,
        actorId: ActorId,
      ) => unknown | Promise<unknown>;
    };
    worker: Worker;
    PostMessage: (...args: unknown[]) => unknown;
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;

/**
 * Evaluate `code` inside an actor with its own `state` in scope.
 *
 * Actors may override `EVALJS` to widen the scope with their own locals; actor
 * functions win over these defaults. Errors are returned rather than thrown so
 * that a bad expression from the agent REPL cannot take the worker down.
 */
async function evaluateActorJs(code: string, state: unknown) {
  const names = ["state", "PostMan", "globalThis"];
  const values = [state, PostMan, globalThis];
  try {
    let evaluator: (...values: unknown[]) => Promise<unknown>;
    try {
      // Prefer expression form so `state.foo` returns a value without `return`.
      evaluator = new AsyncFunction(...names, `"use strict"; return (${code}\n);`);
    } catch {
      evaluator = new AsyncFunction(...names, `"use strict"; ${code}`);
    }
    const result = await evaluator(...values);
    return {
      ok: true,
      type: result === null ? "null" : typeof result,
      inspected: Deno.inspect(result, {
        depth: 8,
        iterableLimit: 200,
        strAbbreviateSize: 20_000,
        getters: false,
        colors: false,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
  }
}

export const functions = {
  //initialize actor
  INIT: (
    payload: {
      callbackKey: string;
      originalPayload: string | null;
      actorId?: ActorId;
    } | null,
  ) => {
    const InternalPostMan = internalPostMan();
    const rawId = payload?.actorId ??
      `${InternalPostMan.state?.name}@${crypto.randomUUID()}`;
    InternalPostMan.state.id = createActorId(rawId);
    const callbackKey = payload?.callbackKey || "";
    InternalPostMan.PostMessage({
      address: { fm: InternalPostMan.state.id, to: System },
      type: "LOADED",
      payload: {
        actorId: InternalPostMan.state.id,
        callbackKey,
      },
    });
    InternalPostMan.functions.__INIT__?.(
      payload?.originalPayload || null,
      InternalPostMan.state.id,
    );
    LogChannel.log(
      "postmanCreate",
      `initialized ${InternalPostMan.state.id} actor with args:`,
      payload?.originalPayload || null,
    );
  },
  EVALJS: async (payload: { code?: string } | null) => {
    const InternalPostMan = internalPostMan();
    const code = payload?.code;
    if (typeof code !== "string" || code.trim().length === 0) {
      return { ok: false, error: "EVALJS requires a non-empty `code` string" };
    }
    return await evaluateActorJs(code, InternalPostMan.state);
  },
  SHUTDOWN: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    LogChannel.log("postman", "Running actor shutdown hook...");
    await InternalPostMan.functions.__SHUTDOWN__?.(
      payload,
      InternalPostMan.state.id,
    );
    return true;
  },
  SHUTDOWN_AND_CLOSE: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    LogChannel.log("postman", "Running cooperative actor shutdown hook...");
    await InternalPostMan.functions.__SHUTDOWN__?.(
      payload,
      InternalPostMan.state.id,
    );
    // runFunctions posts the callback response after this function resolves.
    // Closing on the next task lets that acknowledgement reach the parent first.
    setTimeout(() => {
      LogChannel.log(
        "postman",
        "Cooperative actor shutdown complete; closing worker",
      );
      globalThis.close();
    }, 0);
    return true;
  },
  HEALTH: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    const base = {
      ok: true,
      actorId: InternalPostMan.state.id,
      name: InternalPostMan.state.name,
      addressBookSize: InternalPostMan.state.addressBook.size,
    };
    try {
      const details = await InternalPostMan.functions.__HEALTH__?.(
        payload,
        InternalPostMan.state.id,
      );
      return {
        ...base,
        details: details ?? null,
      };
    } catch (error) {
      return {
        ...base,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  SNAPSHOT: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    return await InternalPostMan.functions.__SNAPSHOT__?.(
      payload,
      InternalPostMan.state.id,
    ) ?? null;
  },
  RESTORE: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    await InternalPostMan.functions.__RESTORE__?.(
      payload,
      InternalPostMan.state.id,
    );
    return true;
  },
  //terminate
  SHUT: async (payload: unknown) => {
    const InternalPostMan = internalPostMan();
    LogChannel.log("postman", "Shutting down...");
    await InternalPostMan.functions.__SHUTDOWN__?.(
      payload,
      InternalPostMan.state.id,
    );
    globalThis.close();
  },
  ADDCONTACT: (payload: ActorId) => {
    const InternalPostMan = internalPostMan();
    InternalPostMan.state.addressBook.add(payload);
    LogChannel.log(
      "postmanNetwork",
      "topic contact intro, added to addressbook",
      InternalPostMan.state.addressBook,
      "inside",
      InternalPostMan.state.id,
    );
  },
  REMOVECONTACT: (payload: ActorId) => {
    const InternalPostMan = internalPostMan();
    InternalPostMan.state.addressBook.delete(payload);
    LogChannel.log(
      "postmanNetwork",
      "contact DEL, removed to addressbook",
      InternalPostMan.state.addressBook,
      "inside",
      InternalPostMan.state.id,
    );
  },
  ADDCONTACTNODE: async (
    payload: { actorId: ActorId; topic: TopicName; nodeid: string },
  ) => {
    const InternalPostMan = internalPostMan();
    // Only send ADDREMOTE if we haven't already added this address to our address book
    if (!InternalPostMan.state.addressBook.has(payload.actorId)) {
      try {
        await PostMan.PostMessage({
          target: System,
          type: "ADDREMOTE",
          payload: payload,
        }, true);
        InternalPostMan.state.addressBook.add(payload.actorId);
        LogChannel.log(
          "postmanNetwork",
          "remote contact intro, added to addressbook",
          InternalPostMan.state.addressBook,
          "inside",
          InternalPostMan.state.id,
        );
      } catch (error) {
        console.error("Error in ADDCONTACTNODE callback:", error);
      }
    } else {
      //console.warn("WARN Skipping duplicate ADDREMOTE for already known address:", payload.actorId);
      LogChannel.log(
        "postmanDEBUG",
        "Skipping duplicate ADDREMOTE for already known address:",
        payload.actorId,
      );
    }
  },
} as const;
