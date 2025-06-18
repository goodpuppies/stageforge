import { PostalService } from "../../../src/mod.ts";
import { websocketPluginFunctions } from "../../../src/lib/plugin/websocket.ts";

const postalservice = new PostalService();
postalservice.register(websocketPluginFunctions(postalservice));

PostalService.debugMode = true;

postalservice.functions.CREATE({ file: "examples/websocket/local/actors/localmain.ts"});
