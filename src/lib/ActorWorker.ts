import type {

    ToAddress,
} from "./types.ts";
import type  { Signal } from "./utils.ts";
import { CustomLogger } from "../logger/customlogger.ts";

export class ActorWorker extends Worker {
    static signal: Signal<ToAddress>;
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        CustomLogger.log("actorsys", "ActorWorker constructor called");
    }

    /* override postMessage(message: Message, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        if (PostalService.actors.has(message.address.to) || message.address.to == System || message.address.fm == System && message.address.to == "WORKER") {
            super.postMessage(message, transferOrOptions as any);
        }
        else {
            throw new Error("No route found");
        }
    } */
}
