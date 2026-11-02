import type { DeleteWith } from "@dlh/server";
import { subtaskIds } from "./links";

/**
 * Deleting a task takes its subtasks that no other live task contains. Restoring
 * offers all its subtasks; Core brings back only those deleted with it.
 */
export const deleteWith: DeleteWith = (tx, id, { restoring }) =>
  subtaskIds(tx, id, { onlyUnshared: !restoring });
