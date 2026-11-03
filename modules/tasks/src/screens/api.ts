import {
  type ModuleWrite,
  type ModuleWriteOptions,
  useModuleApi,
  useModuleWrite,
} from "@dlh/client";
import type { TasksRouter } from "../server";

/** The `tasks` module router, typed. */
export function useTasksApi() {
  return useModuleApi<TasksRouter>("tasks");
}

/** Every Tasks query key starts here, so one invalidation refreshes them all. */
export const TASKS_KEY = ["tasks"] as const;

/** A task's page: the Detail panel. */
export const taskHref = (id: string) => `/tasks/${id}`;

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** What a Tasks write refreshes, and what a conflict says. */
const TASK_WRITE: ModuleWriteOptions = {
  queryKeys: [TASKS_KEY],
  conflictMessage: "Changed since",
};

export type TaskWrite<T> = ModuleWrite<T>;

/**
 * Runs a Tasks mutation: a success toast with Undo, then a refresh. A conflict
 * toasts "Changed since" and refetches; any other failure toasts an error.
 * Resolves to the result, or null when the write failed.
 */
export function useTaskWrite() {
  return useModuleWrite(TASK_WRITE);
}
