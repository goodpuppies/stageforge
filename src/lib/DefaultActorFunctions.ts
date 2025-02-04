import { PostMan } from "./PostMan.ts";
import { System, type ToAddress } from "./types.ts";
import { CustomLogger } from "../logger/customlogger.ts";


//default actor functions

export const functions = {
  //initialize actor
  INIT: (payload: string | null) => {
    PostMan.state.id = `${PostMan.state.name}@${crypto.randomUUID()}`;
    PostMan.PostMessage({
      address: { fm: PostMan.state.id, to: System },
      type: "LOADED",
      payload: PostMan.state.id as ToAddress,
    });
    // @ts-ignore: get custominit from importer
    PostMan.functions.CUSTOMINIT?.(null, PostMan.state.id);
    CustomLogger.log("class", `initied ${PostMan.state.id} actor with args:`, payload);
  },
  CB: (payload: unknown) => {
    if (!PostMan.callback) {
      console.log("CB", payload);
      console.log(PostMan.state.id);
      throw new Error("UNEXPECTED CALLBACK");
    }
    PostMan.callback.trigger(payload);
  },
  //terminate
  SHUT: (_payload: null) => {
    CustomLogger.log("class", "Shutting down...");
    PostMan.worker.terminate();
  },
  ADDCONTACT: (payload: ToAddress) => {
    PostMan.state.addressBook.add(payload);
    console.log("book", PostMan.state.addressBook);
  },
} as const;
