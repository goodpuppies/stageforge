In main.ts
```ts
import { PostalService } from "jsr:@goodpuppies/stageforge";

const postalservice = new PostalService();

const mainAddress = await postalservice.add("./actor.ts");

const string = await postalservice.PostMessage({
  target: mainAddress,
  type: "HELLO",
  payload: null,
}, true);
console.log(string)
```

in actor.ts
```ts
import { PostMan } from "jsr:@goodpuppies/stageforge";

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

  const sub = await PostMan.create("./sub.ts")
  const sub2 = await PostMan.create("./sub.ts")

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
```

in sub.ts
```ts
import { PostMan } from "jsr:@goodpuppies/stageforge";

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
```