import { proxy } from "../../../../src/lib/types.ts";
import { PostMan, actorState } from "../../../../src/mod.ts";


const state = actorState({
  name: "main" as string,
});

export const api = {
  __INIT__: (payload: string) => {
    main(payload);
  }
} as const
new PostMan(state, api);

async function main(_payload: string) {

  const id = await PostMan.create(proxy) //create the websocket server proxy
  console.log(id)



  console.log(await PostMan.PostMessage({
    target: id,
    type: "REQUEST",
    payload: null,
  }, true))

}