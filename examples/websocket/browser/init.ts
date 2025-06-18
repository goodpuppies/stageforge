import { PostalService } from "../../../src/mod.ts";
import { websocketPluginFunctions } from "../../../src/lib/plugin/websocket.ts";

const postalservice = new PostalService();
postalservice.register(websocketPluginFunctions(postalservice));

postalservice.functions.CREATEWSCLIENT({
  file: "./examples/websocket/browser/actors/browsermain.ts",
  url: "ws://localhost:9992",
});
