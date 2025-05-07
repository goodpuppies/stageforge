import { PostMan } from "../../src/mod.ts";
import type { api as subfuncs } from "./sub.ts";

const state = {
  name: "main" as string,
};
export const api = {
  CUSTOMINIT: (payload: string) => {
    main(payload);
  },
  HELLO: (_payload: null) => {
    return "hi"
  },
  LOG: (_payload: void) => {
    console.log("actor", state.id);
  }
} as const
new PostMan(state, api);

async function main(_payload: string) {

  const sub = await PostMan.create("./actors/sub.ts")
  const sub2 = await PostMan.create("./actors/sub.ts")

  PostMan.PostMessage({
    target: [sub, sub2],
    type: "LOG",
    payload: null,
  });
  while (true) {
    const string = await PostMan.PostMessage<typeof subfuncs>({
      target: sub,
      type: "GETSTRING",
      payload: null,
    }, true);
    console.log(string)
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}