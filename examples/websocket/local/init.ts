import { WsClientProxyWorker } from "../../../../WebsockWorker/WsClientProxyWorker.ts"
import { PostalService } from "../../../src/mod.ts";

const postalservice = new PostalService();

postalservice.add({address: "examples/websocket/local/actors/localmain.ts"});

