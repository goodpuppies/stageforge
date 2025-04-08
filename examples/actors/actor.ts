import { BaseState } from "../../src/lib/types.ts";
import { PostMan } from "../../src/mod.ts";

// TypeScript hack: Use declaration merging to augment the state object type
// This allows us to use a simple state object while telling TypeScript about system properties
const state = {
  name: "main" as string,
} 

new PostMan(state, {
  CUSTOMINIT: (payload: string) => {
    main(payload);
  },
  HELLO: (_payload: null) => {
    return "hi"
  },
  LOG: (_payload: null) => {
    console.log("actor", state.id);
  }
} as const);

async function main(_payload: string) {

  const sub = await PostMan.create("./actors/sub.ts")
  const sub2 = await PostMan.create("./actors/sub.ts")

  PostMan.PostMessage({
    target: [sub, sub2],
    type: "LOG",
    payload: null,
  });

  const string = await PostMan.PostMessage({
    target: sub,
    type: "GETSTRING",
    payload: null,
  }, true);
  console.log(string)
}