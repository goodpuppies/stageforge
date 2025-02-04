import { PostMan } from "../../src/mod.ts";

const state = {
  name: "main",
};

new PostMan(state.name, {
  CUSTOMINIT: (payload: string) => {
    main(payload);
  },
  HELLO: (_payload: null) => {
    return "hi"
  },
  LOG: (_payload: null) => {
    console.log("actor", PostMan.state.id);
  }
} as const);

async function main(_payload: string) {

  const sub = await PostMan.create("./actors/sub.ts")
  const sub2 = await PostMan.create("./actors/sub.ts")

  PostMan.PostMessage({
    target: sub2,
    type: "CHANGENAME",
    payload: "sub2"
  })

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