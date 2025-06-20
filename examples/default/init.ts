import { PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

PostalService.debugMode = false;

await postalservice.functions.CREATE({ file: "./actors/actor.ts" });
