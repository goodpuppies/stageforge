import { PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

postalservice.functions.CREATE({ file: "./actors/actor.ts" });
