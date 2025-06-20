import { actorState, PostMan } from "../../../src/mod.ts";

const state = actorState({
  name: "test-actor" as string,
});

export const api = {
  __INIT__: () => {
    console.log("Test actor initialized with id:", state.id);
    PostMan.setTopic("test-topic");
  },
  ECHO: (payload: unknown) => {
    console.log("Test actor received ECHO with payload:", payload);
    return payload;
  },
  ADD: (payload: { a: number; b: number }) => {
    console.log("Test actor received ADD with payload:", payload);
    if (typeof payload.a !== "number" || typeof payload.b !== "number") {
      throw new Error("Invalid payload for ADD: a and b must be numbers.");
    }
    return payload.a + payload.b;
  },
} as const;

new PostMan(state, api);
