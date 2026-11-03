import { describeModule } from "@dlh/core";
import { requestOps } from "./operations";

/** What Requests is and does, shared by its manifest and its server module. */
export const requestsModule = describeModule({
  id: "requests",
  itemTypes: ["request"],
  operations: requestOps,
});
