import { WsClientProxyWorker } from "../../../../WebsockWorker/WsClientProxyWorker.ts";
import { WsClientWorker } from "../../../../WebsockWorker/WsClientWorker.ts";
import { Signal } from "../Signal.ts";
import { PostalService } from "../PostalService.ts";
import {
  type ActorId,
  type ActorW,
  type GenericActorFunctions,
  type Message,
  System,
} from "../types.ts";

export const websocketPluginFunctions = (postalService: PostalService): GenericActorFunctions => ({
  CREATEWSCLIENT: async ({ file, url }: { file: string, url: string }) => {

    const fileUrl = new URL(file, `file://${Deno.cwd()}/`).href;
    const worker = new WsClientWorker(fileUrl, url, { name: file, type: "module" }) as Worker
  
    worker.onmessage = (event: MessageEvent<Message>) => {
      postalService.OnMessage(event.data);
    };
  
    const actorSignal = new Signal<ActorId>("createwsclient", 5000);

    // Send the INIT message with the callback key in the payload
    worker.postMessage({
      address: { fm: System, to: "WORKER" },
      type: "INIT",
      payload: {
        callbackKey: actorSignal.id,
        originalPayload: null,
      },
    });

    const id = await actorSignal.wait(); //id
    const actor: ActorW = {
      worker,
    };
    PostalService.actors.set(id, actor);
    return id;
  },
  CREATEWSPROXY: async () => {
    console.log("creating proxy");
  
    const worker: Worker = new WsClientProxyWorker({ port: 9992 });
    console.log("created proxy");
    worker.onmessage = (event: MessageEvent<Message>) => {
      postalService.OnMessage(event.data);
    };
    

    const idSignal = new Signal<ActorId>('get-proxy-actor-id', 9000);

    worker.postMessage({
      address: { fm: System, to: "WORKER" },
      type: `GETID:${idSignal.id}`,
      payload: null,
    });

    const id = await idSignal.wait();

    console.log("created actor for proxy with id:", id);
    const actor: ActorW = {
      worker,
    };
    PostalService.actors.set(id, actor);
    return id;
  },
});
