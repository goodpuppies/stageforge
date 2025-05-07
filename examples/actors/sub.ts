import { PostMan } from "../../src/mod.ts";

const state = {
  name: "sub",
};

export const api = {
  HELLO: (_payload: null) => {
    return "hi"
  },
  LOG: (_payload: null) => {
    console.log("hello from", PostMan.state.id);
  },
  GETSTRING: (_payload: null) => {
    return "a"
  }
} as const

new PostMan(state, api);