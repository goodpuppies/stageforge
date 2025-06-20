import { type ActorId, PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

PostalService.debugMode = false;

const mainActorId = await postalservice.functions.CREATE({ file: "./actors/actor.ts" }) as ActorId;

const response = await postalservice.PostMessage({
  target: mainActorId,
  type: "HELLO",
}, true);

console.log(response); // "hi"
