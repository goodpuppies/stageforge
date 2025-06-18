import { PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

PostalService.debugMode = true;

await postalservice.functions.CREATE({ file: "./actors/actor.ts" });


