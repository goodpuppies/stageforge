import { actorState, PostMan } from "../../src/mod.ts";

const state = actorState({ name: "process-echo" });

new PostMan(
  state,
  {
    ECHO: (payload: unknown) => payload,
    PROCESSID: (_payload: null) => Deno.pid,
  } as const,
);
