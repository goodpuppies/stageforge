import { ActorId, PostMan, actorState } from "../../../src/mod.ts";
import type { api as TestActorApi } from "./test-actor.ts";

const state = actorState({
  name: "main-test-coordinator",
});

export const api = {
  __INIT__: () => {
    console.log("Main Test Coordinator initialized with id:", state.id);
    PostMan.setTopic("test-topic"); // Join the topic
  },
  RUN_TEST_SUITE: async () => {
    const results: Array<{ description: string; status: string; details?: string }> = [];
    let testActorAddress: ActorId | undefined;

    try {
      results.push({ description: "Attempting to create test-actor", status: "running" });
      const testActorScriptUrl = new URL('./test-actor.ts', import.meta.url).href;
      testActorAddress = await PostMan.create(testActorScriptUrl);
      results[results.length -1].status = "success";
      results[results.length -1].details = `Test Actor created with address: ${testActorAddress}`;

      // Create two more test actors for topic testing (they will also join 'test-topic' on __INIT__)
      results.push({ description: "Topic API: Create 2 additional actors for topic", status: "running" });
      try {
        // Ensure these actors are created and have a chance to register their topics
        await PostMan.create(testActorScriptUrl); 
        await PostMan.create(testActorScriptUrl);
        // Adding a slight delay to allow for topic propagation, if necessary, though PostMan.setTopic should be synchronous in its effect on the local addressBook via PostalService if workers are on the same thread or messages are processed fast.
        // await new Promise(resolve => setTimeout(resolve, 100)); // Optional: if race conditions are observed
        results[results.length -1].status = "success";
        results[results.length -1].details = "Successfully initiated creation of 2 additional actors for topic testing.";
      } catch (e) {
        results[results.length -1].status = "error";
        results[results.length -1].details = `Failed to create additional actors: ${(e as Error).message}`;
      }

    } catch (e) {
      results[results.length -1].status = "error";
      results[results.length -1].details = `Failed to create initial test-actor: ${(e as Error).message}`;
      return results; 
    }

    // Test ECHO
    const echoPayload = "Hello from Coordinator!";
    results.push({ description: `Sending ECHO with payload: "${echoPayload}"`, status: "running" });
    try {
      const echoResult = await PostMan.PostMessage<typeof TestActorApi>(
        {
          target: testActorAddress!,
          type: 'ECHO',
          payload: echoPayload,
        },
        true
      );
      results[results.length -1].status = echoResult === echoPayload ? "success" : "error";
      results[results.length -1].details = `ECHO Result: "${echoResult}" (Expected: "${echoPayload}")`;
    } catch (e) {
      results[results.length -1].status = "error";
      results[results.length -1].details = `ECHO failed: ${(e as Error).message}`;
    }

    // Test ADD (success)
    const addPayloadSuccess = { a: 15, b: 10 };
    results.push({ description: `Sending ADD with payload: ${JSON.stringify(addPayloadSuccess)}`, status: "running" });
    try {
      const addResultSuccess = await PostMan.PostMessage<typeof TestActorApi>(
        {
          target: testActorAddress!,
          type: 'ADD',
          payload: addPayloadSuccess,
        },
        true
      );
      const expectedSum = addPayloadSuccess.a + addPayloadSuccess.b;
      results[results.length -1].status = addResultSuccess === expectedSum ? "success" : "error";
      results[results.length -1].details = `ADD Result: ${addResultSuccess} (Expected: ${expectedSum})`;
    } catch (e) {
      results[results.length -1].status = "error";
      results[results.length -1].details = `ADD (success case) failed: ${(e as Error).message}`;
    }

    // Test Topic API and Address Book Verification
    results.push({ description: "Topic API: Verify initial test actor in coordinator's address book", status: "running" });
    if (testActorAddress && state.addressBook.has(testActorAddress)) {
      results[results.length -1].status = "success";
      results[results.length -1].details = `Coordinator's address book contains the explicitly created test actor: ${testActorAddress}`;
    } else {
      results[results.length -1].status = "error";
      results[results.length -1].details = `Coordinator's address book DOES NOT contain ${testActorAddress}. Current book: ${Array.from(state.addressBook).join(', ')}. Expected to find ${testActorAddress}`;
    }

    results.push({ description: "Topic API: Verify total number of actors in coordinator's address book (expected 3 test-actors)", status: "running" });
    const expectedActorsInBook = 3; // The 3 test-actor instances that joined 'test-topic'
    if (state.addressBook.size === expectedActorsInBook) {
      results[results.length -1].status = "success";
      results[results.length -1].details = `Coordinator's address book size is ${state.addressBook.size} as expected. Actors: ${Array.from(state.addressBook).join(', ')}`;
    } else {
      results[results.length -1].status = "error";
      results[results.length -1].details = `Coordinator's address book size is ${state.addressBook.size}, expected ${expectedActorsInBook}. Actors: ${Array.from(state.addressBook).join(', ')}`;
    }

    return results;
  },
} as const;

new PostMan(state, api);
