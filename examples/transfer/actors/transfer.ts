import { actorState, PostMan } from "../../../src/mod.ts";

const state = actorState({
  name: "transfer",
});

export const api = {
  SUM: (payload: Uint8Array) => {
    return payload.reduce((total, value) => total + value, 0);
  },
} as const;

new PostMan(state, api);
