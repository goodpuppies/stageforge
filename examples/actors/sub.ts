import { PostMan } from "../../src/mod.ts";

const state = {
  name: "sub",
};

new PostMan(state.name, {
  HELLO: (_payload: null) => {
    return "hi"
  },
  LOG: (_payload: null) => {
    console.log("hello from", PostMan.state.id);
  }
} as const);