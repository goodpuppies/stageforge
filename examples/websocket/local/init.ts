import { PostalService } from "../../../src/mod.ts";

const postalservice = new PostalService();

PostalService.debugMode = true;

postalservice.functions.CREATE({ file: "examples/websocket/local/actors/localmain.ts"});
