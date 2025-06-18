import { actorState, PostMan } from "../../../../src/mod.ts";

const state = actorState({
  name: "mainbrowser" as string,
});

export const api = {
  __INIT__: (payload: string) => {
    main(payload);
  },
  REQUEST: (_payload: null) => {
    return "secretdata";
  },
} as const;
new PostMan(state, api);

async function main(_payload: string) {
}
