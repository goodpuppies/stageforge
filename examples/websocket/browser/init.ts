import { PostalService } from "../../../src/mod.ts";

const postalservice = new PostalService();

postalservice.functions.CREATEWSCLIENT({
  file: "./examples/websocket/browser/actors/browsermain.ts",
  url: "ws://localhost:9992",
});
