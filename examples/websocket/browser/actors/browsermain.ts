import { PostMan, actorState } from "../../../../src/mod.ts";

const state = actorState({
  name: "main" as string,
});

export const api = {
  __INIT__: (payload: string) => {
    main(payload);
  },
  REQUEST: (_payload: null) => {
    return "hi";
  },
} as const
new PostMan(state, api);

async function main(_payload: string) {


}