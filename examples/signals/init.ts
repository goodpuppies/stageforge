import { PostalService } from "../../src/mod.ts";

const postalservice = new PostalService();

await postalservice.create("./actors/actor.ts");
