import { defineServerModule } from "@dlh/server";
import { deleteWith } from "./server/deleteWith";
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

export default defineServerModule({
  id: "tasks",
  itemTypes: ["task"],
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
  },
});
