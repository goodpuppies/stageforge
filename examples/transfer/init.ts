import { PostalService } from "../../src/mod.ts";
import type { api as transferApi } from "./actors/transfer.ts";

const postalservice = new PostalService();

const actor = await postalservice.create<typeof transferApi>("./actors/transfer.ts");
const data = new Uint8Array([1, 2, 3, 4]);

const sum = await postalservice.PostMessage<typeof transferApi>({
  target: actor.id,
  type: "SUM",
  payload: data,
  transfer: [data.buffer],
}, true);

console.log(sum); // 10
console.log(data.byteLength); // 0, ownership moved to the worker
