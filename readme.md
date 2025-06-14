StageForge is a TypeScript library that simplifies creating and managing actor-based web worker communication.

Mainly used in https://github.com/goodpuppies/petplay

## Basic Usage

### main.ts - Create the coordinator
```ts
import { PostalService } from "jsr:@goodpuppies/stageforge";

// Initialize the postal service (central coordinator)
const postalService = new PostalService();

// Create a new actor from the specified file
const mainActorId = await postalService.add("./actor.ts");

// Send a message and wait for response
const response = await postalService.PostMessage({
  target: mainActorId,
  type: "HELLO",
  payload: null,
}, true);

console.log(response); // "hi"
```

### actor.ts - Define an actor
```ts
import { PostMan, actorState } from "jsr:@goodpuppies/stageforge";

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
  }
} as const;

// Initialize the actor with state and API
new PostMan(state, api);

// Your main actor logic
async function main(_payload: string) {
  // Create a child actor
  const subActorId = await PostMan.create("./sub.ts");
  
  // Send a message with type checking
  const response = await PostMan.PostMessage<typeof subApi>({
    target: subActorId,
    type: "GETSTRING", 
    payload: null,
  }, true);
  
  console.log(response);
}
```

### sub.ts - Define a child actor
```ts
import { PostMan, actorState } from "jsr:@goodpuppies/stageforge";

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
  }
} as const;

// Initialize the actor with state and API
new PostMan(state, api);
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
  .filter((addr) => addr.startsWith('sub@'));

// To unsubscribe from a topic:
PostMan.delTopic("shared-channel");
```

### Typed Message API

Better typing support is in the works. 0.1 adds typing to PostMessage.

```ts
// In sub.ts
export const api = {
  ADD: (payload: { a: number, b: number }) => {
    return payload.a + payload.b;
  }
} as const;

// In main.ts
import type { api as subApi } from "./sub.ts";

// Type-checked message - compiler will validate type and payload
const result = await PostMan.PostMessage<typeof subApi>({
  target: subActorId,
  type: "ADD",  // Autocomplete works here
  payload: { a: 5, b: 3 }  // Type checked!
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
