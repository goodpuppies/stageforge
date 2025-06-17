import { PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

const mainAddress = await postalservice.add({address: "./actors/actor.ts"});

const string = await postalservice.PostMessage({
  target: mainAddress,
  type: "HELLO",
  payload: null,
}, true);
console.log(string)