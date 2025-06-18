import { actorState, PostMan, System } from "../../../../src/mod.ts";

const state = actorState({
  name: "mainlocal" as string,
});

export const api = {
  __INIT__: (payload: string) => {
    main(payload);
  },
} as const;
new PostMan(state, api);

async function main(_payload: string) {
  const id = await PostMan.PostMessage({
    target: System,
    type: "CREATEWSPROXY",
    payload: null,
  }, true)
  console.log(id);

  console.log(
    await PostMan.PostMessage({
      target: id,
      type: "REQUEST",
      payload: null,
    }, true),
  );
}
