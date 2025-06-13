import { WsClientWorker } from "../../../../WebsockWorker/WsClientWorker.ts"
import { PostalService } from "../../../src/mod.ts";

const postalservice = new PostalService(WsClientWorker as any);

postalservice.add({
  address : "C:/Git/stageforge/examples/websocket/browser/actors/browsermain.ts", 
  url: "ws://localhost:9992"
});
