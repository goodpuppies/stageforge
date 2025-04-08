import { PostMan } from "./PostMan.ts";
import { System, type ToAddress } from "./types.ts";
import { CustomLogger } from "../logger/customlogger.ts";


//default actor functions

export const functions = {
  //initialize actor
  INIT: (payload: { callbackKey: string, originalPayload: string | null } | null) => {
    PostMan.state.id = `${PostMan.state.name}@${crypto.randomUUID()}` as ToAddress;
    const callbackKey = payload?.callbackKey || '';
    PostMan.PostMessage({
      address: { fm: PostMan.state.id, to: System },
      type: "LOADED",
      payload: {
        actorId: PostMan.state.id as ToAddress,
        callbackKey
      },
    });
    // @ts-ignore: get custominit from importer
    PostMan.functions.CUSTOMINIT?.(payload?.originalPayload || null, PostMan.state.id);
    CustomLogger.log("postman", `initied ${PostMan.state.id} actor with args:`, payload?.originalPayload || null);
  },
  //terminate
  SHUT: (_payload: null) => {
    CustomLogger.log("class", "Shutting down...");
    PostMan.worker.terminate();
  },
  ADDCONTACT: (payload: ToAddress) => {
    PostMan.state.addressBook.add(payload);
    CustomLogger.log("postman", "contact intro, added to addressbook", PostMan.state.addressBook, "inside", PostMan.state.id);
  },
  ADDCONTACTNODE: async (payload: { actorId: ToAddress, topic: string, nodeid: string,  }) => {
    console.log("got remote add!")
    
    // Only send ADDREMOTE if we haven't already added this address to our address book
    if (!PostMan.state.addressBook.has(payload.actorId)) {
      try {
        await PostMan.PostMessage({
          target: System,
          type: "ADDREMOTE",
          payload: payload
        }, true);
      
        PostMan.state.addressBook.add(payload.actorId);
        CustomLogger.log("postman", "remote contact intro, added to addressbook", PostMan.state.addressBook, "inside", PostMan.state.id);
      } catch (error) {
        console.error("Error in ADDCONTACTNODE callback:", error);
      }
    } else {
      console.warn("WARN Skipping duplicate ADDREMOTE for already known address:", payload.actorId);
      CustomLogger.log("postman", "Skipping duplicate ADDREMOTE for already known address:", payload.actorId);
    }
  },
} as const;
