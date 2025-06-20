import { actorState, PostMan, Signal, wait } from "../../../src/mod.ts";

const state = actorState({
  name: "main",
  value: new Signal<string>("value", ""),
});

export const api = {
  __INIT__: (payload: string) => {
    main(payload);
  },
} as const;
new PostMan(state, api);

async function main(_payload: string) {
  const _stop = state.value.watch((value) => {
    console.log(value);
  });

  while (true) {
    await wait(1000);
    state.value.set(Math.random().toString());
  }
}
