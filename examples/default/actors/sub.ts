import { PostMan, actorState } from "../../../src/mod.ts";
import { wait } from "../../../src/lib/utils.ts";

const state = actorState({
  name: "sub",
});

export const api = {
  __INIT__: (_payload: string) => {
    PostMan.setTopic("muffin")
    main()
  },
  LOG: (_payload: null) => {
    console.log("hello from", state.id);
  },
  GETSTRING: (_payload: null, ctx: any) => {
    console.log(ctx.sender)
    return "some text"
  },
  ADD: (payload: { a: number, b: number }) => {
    return payload.a + payload.b;
  }
} as const;

new PostMan(state, api);

async function main() {
  while (true) {
    await wait(5000)
    console.log("in ", state.id, " ", state.addressBook)
  }
}