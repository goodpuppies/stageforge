import { PostalService } from "../../src/mod.ts";
import type { api as mainApi } from "./actors/actor.ts";

const postalservice = new PostalService();

PostalService.debugMode = false;

const actor = await postalservice.create<typeof mainApi>("./actors/actor.ts");
const response = await actor.HELLO();

console.log(response); // "hi"
