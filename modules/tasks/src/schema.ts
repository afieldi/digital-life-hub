import { type Due, dueValue, itemSummary } from "@dlh/core";
import { z } from "zod";

/** Ordered in code: `medium` < `high`. A new level is a migration on the check constraint. */
export const priority = z.enum(["medium", "high"]);
export type Priority = z.infer<typeof priority>;

/** Who works the task. Only `tasks.setAssignee` changes it. */
export const assignee = z.enum(["me", "agent"]);
export type Assignee = z.infer<typeof assignee>;

export const subtaskSummary = z.object({
  total: z.number().int(),
  done: z.number().int(),
  /** Title of the first open subtask. */
  next: z.string().nullable(),
});
export type SubtaskSummary = z.infer<typeof subtaskSummary>;

export const taskRow = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  due: dueValue.nullable(),
  priority,
  assignee,
  notes: z.string().nullable(),
  /** The due day in the caller's time zone. */
  day: z.string().nullable(),
  subtasks: subtaskSummary,
  parents: z.array(itemSummary),
  linkedNotes: z.number().int(),
  sortKey: z.string(),
});
export type TaskRow = z.infer<typeof taskRow>;
export type { Due };
