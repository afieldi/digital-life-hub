import type { DeleteWith } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { hasTaskGrandparent, hasTaskParent, subtaskIds } from "./links";

/**
 * Deleting a task takes its subtasks that no other live task contains. Restoring
 * offers all its subtasks; Core brings back only those deleted with it. A
 * restore that would nest subtasks two deep (its parent became a subtask, or it
 * has subtasks and gained a parent meanwhile) is refused, which rolls it back.
 */
export const deleteWith: DeleteWith = async (tx, id, { restoring }) => {
  const ids = await subtaskIds(tx, id, { onlyUnshared: !restoring });
  if (restoring) {
    const nested =
      (await hasTaskGrandparent(tx, id)) ||
      (ids.length > 0 && (await hasTaskParent(tx, id)));
    if (nested) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Restoring it would put a subtask inside a subtask",
      });
    }
  }
  return ids;
};
