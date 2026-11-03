import { describeModule } from "@dlh/core";
import { tasksAiActions } from "./ai";
import { taskOps } from "./operations";

/** What Tasks is and does, shared by its manifest and its server module. */
export const tasksModule = describeModule({
  id: "tasks",
  itemTypes: ["task"],
  operations: taskOps,
  aiActions: Object.values(tasksAiActions),
});
