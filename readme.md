StageForge is a TypeScript library that simplifies creating and managing actor-based web worker communication.

Mainly used in https://github.com/goodpuppies/petplay

## Basic Usage

### main.ts - Create the coordinator

```ts
import { PostalService } from "@goodpuppies/stageforge";
import type { api as mainApi } from "./actor.ts";

// Initialize the postal service (central coordinator)
const postalService = new PostalService();

// Create a new actor from the specified file
const mainActor = await postalService.create<typeof mainApi>("./actor.ts");

// Send a message and wait for response
const response = await mainActor.HELLO();

console.log(response); // "hi"
```

### actor.ts - Define an actor

```ts
import { actorState, PostMan } from "@goodpuppies/stageforge";

// Create a type-safe state with proper initialization
const state = actorState({
  name: "main",
  // Add your custom state properties
});

// Define your actor's message handlers with strict typing
export const api = {
  // Special initialization handler
  __INIT__: (payload: string) => {
    console.log("Actor initialized with ID:", state.id);
    main(payload);
  },
  HELLO: (_payload: null) => {
    return "hi";
  },
  LOG: (_payload: null) => {
    console.log("Actor:", state.id);
  },
} as const;

// Initialize the actor with state and API
new PostMan(state, api);

// Your main actor logic
async function main(_payload: string) {
  // Create a child actor
  const subActor = await PostMan.create<typeof subApi>("./sub.ts");

  // Send a message with type checking
  const response = await subActor.GETSTRING();

  console.log(response);
}
```

### sub.ts - Define a child actor

```ts
import { actorState, PostMan } from "jsr:@goodpuppies/stageforge";

const state = actorState({
  name: "sub",
});

// Export API for type checking in other actors
export const api = {
  __INIT__: (_payload: null) => {
    console.log("Sub actor initialized");
  },
  GETSTRING: (_payload: null) => {
    return "Hello from sub actor";
  },
  LOG: (_payload: null) => {
    console.log("Hello from", state.id);
  },
} as const;

// Initialize the actor with state and API
new PostMan(state, api);
```

## New Features in 0.3.0

### Simpler Actor Calls

`create` can now return a typed actor client. Calling a method without awaiting sends a fire-and-forget message, while awaiting the call waits for the
handler result.

```ts
import type { api as subApi } from "./sub.ts";

const sub = await PostMan.create<typeof subApi>("./sub.ts");

sub.LOG();

const text = await sub.GETSTRING();
```

The actor id is still available for lower-level routing:

```ts
console.log(sub.id);
```

### Transferable Payloads

Explicit `PostMessage` calls now support transfer lists for ownership-moving worker messages. The `transfer` field is optional; omit it for normal
cloned messages.

```ts
const data = new Uint8Array([1, 2, 3, 4]);

const sum = await PostMan.PostMessage<typeof transferApi>({
  target: actor.id,
  type: "SUM",
  payload: data,
  transfer: [data.buffer],
}, true);
```

Transfer lists are intentionally kept on `PostMessage` instead of the actor-client shorthand, because transferring detaches ownership from the sender.
Transfer with multiple targets is rejected.

## New Features in 0.2.0

### Stageforge signals

see examples/signals

### Worker plugins for networking

unstable

### PostalService now exposes GenericActorFunctions

```ts
const mainActorId = await postalService.functions.CREATE({ file: "./actor.ts" });

postalService.functions.MURDER(mainActorId);
```

### Payloads are now optional

```ts
PostMan.PostMessage({
  target: actors,
  type: "LOG",
});

//they are nulled when missing
if (!message.payload) {
  message.payload = null;
}
```

### Parent api

Actor state now includes parent as an explicit property

```ts
const state = actorState({
  name: "main",
});

console.log("my parent is", state.parent);

//parents can be overriden on creation
const sub = await PostMan.create<typeof subApi>("./actors/sub.ts", undefined, System);
```

### PostMan context is exposed

Handlers can now check internal postman properties such as ctx.sender to see the senders address

```ts
export const api = {
  GETSTRING: (_payload: null, ctx: typeof PostMan) => {
    console.log("getstring ctx sender", ctx.sender);
    console.log("getstring ctx", ctx);
    return "some text";
  },
} as const;
```

## New Features in 0.1.0

### Topics API

The Topics API allows actors to discover each other automatically by subscribing to named topics:

```ts
// In actor1.ts
PostMan.setTopic("shared-channel");

// In actor2.ts
PostMan.setTopic("shared-channel");
// Now actor1 and actor2 automatically know about each other
// Their IDs are added to each other's addressBook

// To find actors in the addressBook you can do something like
const actors = Array.from(state.addressBook)
  .filter((addr) => addr.startsWith("sub@"));

// To unsubscribe from a topic:
PostMan.delTopic("shared-channel");
```

### Typed Message API

Better typing support is in the works. 0.1 adds typing to PostMessage.

```ts
// In sub.ts
export const api = {
  ADD: (payload: { a: number; b: number }) => {
    return payload.a + payload.b;
  },
} as const;

// In main.ts
import type { api as subApi } from "./sub.ts";

// Type-checked message - compiler will validate type and payload
const result = await PostMan.PostMessage<typeof subApi>({
  target: subActorId,
  type: "ADD", // Autocomplete works here
  payload: { a: 5, b: 3 }, // Type checked!
}, true);
```

### Improved Actor State

Actor state api now has better ts support so you can always get type info about the state.

```ts
import { actorState } from "jsr:@goodpuppies/stageforge";

const state = actorState({
  name: "myActor",
  // Your custom state properties:
  counter: 0,
  data: new Map(),
  custom: null as null | myType,
});
```

## License

MIT
