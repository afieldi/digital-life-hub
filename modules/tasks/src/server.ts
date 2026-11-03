import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { tasksModule } from "./module";
import { tasksAiRunners } from "./server/ai";
import { deleteWith } from "./server/deleteWith";
import { due, get, list, stats } from "./server/reads";
import { seed } from "./server/seed";
import {
  addParent,
  complete,
  create,
  removeParent,
  reopen,
  reorder,
  reschedule,
  rescheduleMany,
  update,
} from "./server/writes";

const tasksServer = defineServerModule(tasksModule, {
  migrations: true,
  deleteWith,
  seed,
  operations: {
    create,
    update,
    complete,
    reopen,
    reschedule,
    rescheduleMany,
    reorder,
    addParent,
    removeParent,
    due,
    list,
    get,
    stats,
  },
  aiRunners: tasksAiRunners,
});

/** The `tasks` router as the screens call it (type only: no server code in the bundle). */
export type TasksRouter = OperationsRouter<typeof tasksServer.operations>;

export default tasksServer;
