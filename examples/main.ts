import { PostalService } from "../src/mod.ts";
import { IrohWebWorker } from "../../IrohWorker/IrohWorker.ts"

const postalservice = new PostalService(IrohWebWorker);

const mainAddress = await postalservice.add("./actors/actor.ts");

const string = await postalservice.PostMessage({
  target: mainAddress,
  type: "HELLO",
  payload: null,
}, true);
console.log(string)