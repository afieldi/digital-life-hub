import { describeModule } from "@dlh/core";
import { agentOps } from "./operations";

/** What Agent is and does, shared by its manifest and its server module. It owns no item type. */
export const agentModule = describeModule({
  id: "agent",
  itemTypes: [],
  operations: agentOps,
});
