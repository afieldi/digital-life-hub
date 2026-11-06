import { describeModule } from "@dlh/core";
import { slackOps } from "./operations";

/** What Slack is and does, shared by its manifest and its server module. It owns no item type. */
export const slackModule = describeModule({
  id: "slack",
  itemTypes: [],
  operations: slackOps,
});
