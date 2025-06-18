import { wait } from "../../../src/lib/utils.ts";
import { actorState, PostMan } from "../../../src/mod.ts";
import type { api as subApi } from "./sub.ts";

const state = actorState({
  name: "main" as string,
});

export const api = {
  __INIT__: (payload: string) => {
    PostMan.setTopic("muffin");
    console.log("id is", state.id);
    main(payload);
  },
  HELLO: (_payload: null) => {
    return "hi";
  },
  LOG: (_payload: void) => {
    console.log("actor", state.id);
  },
} as const;
new PostMan(state, api);

async function main(_payload: string) {
  const sub = await PostMan.create("./actors/sub.ts");
  console.log(sub);
  await PostMan.create("./actors/sub.ts");

  const actors = Array.from(state.addressBook)
    .filter((addr) => addr.startsWith("sub@"));

  PostMan.PostMessage<typeof subApi>({
    target: actors,
    type: "LOG",
    payload: null,
  });
  const result = await PostMan.PostMessage<typeof subApi>({
    target: sub,
    type: "ADD", // Autocomplete works here
    payload: { a: 5, b: 3 }, // Type checked!
  }, true);

  console.log(result);

  while (true) {
    const string = await PostMan.PostMessage<typeof subApi>({
      target: sub,
      type: "GETSTRING",
      payload: null,
    }, true);
    console.log(string);
    console.log("in ", state.id, " ", state.addressBook);
    await wait(5000);
  }
}
