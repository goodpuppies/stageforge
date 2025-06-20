import { actorState, PostMan, wait } from "../../../src/mod.ts";

const state = actorState({
  name: "sub",
});

export const api = {
  __INIT__: (_payload: string) => {
    PostMan.setTopic("muffin");
    main();
  },
  LOG: (_payload: null) => {
    console.log("hello from", state.id);
  },
  GETSTRING: (_payload: null, ctx: typeof PostMan) => {
    console.log("getstring ctx sender", ctx.sender);
    console.log("getstring ctx", ctx);
    return "some text";
  },
  ADD: (payload: { a: number; b: number }) => {
    return payload.a + payload.b;
  },
} as const;

new PostMan(state, api);

async function main() {
  while (true) {
    await wait(5000);
    console.log("in ", state.id, " ", state.addressBook);
  }
}
