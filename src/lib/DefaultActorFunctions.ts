import { PostMan } from "./PostMan.ts";
import { System, type ActorId, createActorId } from "./types.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";


//default actor functions

export const functions = {
  //initialize actor
  INIT: (payload: { callbackKey: string, originalPayload: string | null, parentId: ActorId | null } | null) => {
    //@ts-expect-error PostMan.state is internal
    const rawId = `${PostMan.state?.name}@${crypto.randomUUID()}`;
    //@ts-expect-error PostMan.state is internal
    PostMan.state.id = createActorId(rawId);
    //@ts-expect-error PostMan.state is internal
    PostMan.state.parent = payload?.parentId || null;
    const callbackKey = payload?.callbackKey || '';
    PostMan.PostMessage({
      //@ts-expect-error PostMan.state is internal
      address: { fm: PostMan.state.id, to: System },
      type: "LOADED",
      payload: {
        //@ts-expect-error PostMan.state is internal
        actorId: PostMan.state.id,
        callbackKey
      },
    });
    // @ts-ignore: get custominit from importer
    PostMan.functions.__INIT__?.(payload?.originalPayload || null, PostMan.state.id);
    //@ts-expect-error PostMan.state is internal
    LogChannel.log("postmanCreate", `initialized ${PostMan.state.id} actor with parent ${PostMan.state.parent} and args:`, payload?.originalPayload || null);
  },
  //terminate
  SHUT: (_payload: null) => {
    LogChannel.log("postman", "Shutting down...");
    PostMan.worker.terminate();
  },
  ADDCONTACT: (payload: ActorId) => {
    //@ts-expect-error PostMan.state is internal
    PostMan.state.addressBook.add(payload);
    //@ts-expect-error PostMan.state is internal
    LogChannel.log("postmanNetwork", "topic contact intro, added to addressbook", PostMan.state.addressBook, "inside", PostMan.state.id);
  },
  REMOVECONTACT: (payload: ActorId) => {
    //@ts-expect-error PostMan.state is internal
    PostMan.state.addressBook.delete(payload);
    //@ts-expect-error PostMan.state is internal
    LogChannel.log("postmanNetwork", "contact DEL, removed to addressbook", PostMan.state.addressBook, "inside", PostMan.state.id);
  },
  ADDCONTACTNODE: async (payload: { actorId: ActorId, topic: string, nodeid: string,  }) => {
    
    // Only send ADDREMOTE if we haven't already added this address to our address book
    //@ts-expect-error PostMan.state is internal
    if (!PostMan.state.addressBook.has(payload.actorId)) {
      try {
        await PostMan.PostMessage({
          target: System,
          type: "ADDREMOTE",
          payload: payload
        }, true);
        //@ts-expect-error PostMan.state is internal
        PostMan.state.addressBook.add(payload.actorId);
        //@ts-expect-error PostMan.state is internal
        LogChannel.log("postmanNetwork", "remote contact intro, added to addressbook", PostMan.state.addressBook, "inside", PostMan.state.id);
      } catch (error) {
        console.error("Error in ADDCONTACTNODE callback:", error);
      }
    } else {
      //console.warn("WARN Skipping duplicate ADDREMOTE for already known address:", payload.actorId);
      LogChannel.log("postmanDEBUG", "Skipping duplicate ADDREMOTE for already known address:", payload.actorId);
    }
  },
} as const;
