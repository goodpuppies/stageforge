import { PostalService } from "../src/mod.ts";
import { IrohWebWorker } from "../../irohworker/IrohWorker.ts"

const postalservice = new PostalService(IrohWebWorker);

postalservice.initSignalingClient("ws://localhost:8080");

const mainAddress = await postalservice.add("./actors/actor.ts");
const mainAddress2 = await postalservice.add("./actors/actor2.ts");

postalservice.PostMessage({
  target: [mainAddress, mainAddress2],
  type: "HELLO",
  payload: null,
});


