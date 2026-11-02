import { useCoreApi, useItemsChanged, useModuleApi } from "@dlh/client";
import { toast } from "@dlh/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { TasksRouter } from "../server";

/** What a mutation hands back to undo it, as `ops.undo` takes it. */
type UndoToken = Parameters<
  ReturnType<typeof useCoreApi>["ops"]["undo"]["mutate"]
>[0]["token"];

/** The `tasks` module router, typed. */
export function useTasksApi() {
  return useModuleApi<TasksRouter>("tasks");
}

/** Every Tasks query key starts here, so one invalidation refreshes them all. */
export const TASKS_KEY = ["tasks"] as const;

/** How long a write's toast keeps its Undo. */
export const UNDO_TOAST_MS = 10_000;

/** A task's page: the Detail panel. */
export const taskHref = (id: string) => `/tasks/${id}`;

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A write refused because the task changed since it was read. */
export function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: string } }).data?.code === "CONFLICT"
  );
}

export type TaskWrite<T> = {
  /** The operation's id, as `ops.undo` takes it. */
  op: string;
  /** What the toast says, e.g. the operation's summary. */
  summary: string;
  /** What to call it in an error ("Couldn't complete"). */
  verb: string;
  call: () => Promise<{ result: T; undo: UndoToken }>;
  /** No success toast, e.g. for notes saved as you type. Failures still toast. */
  quiet?: boolean;
};

/**
 * Runs a Tasks mutation: a success toast with Undo, then a refresh. A conflict
 * toasts "Changed since" and refetches; any other failure toasts an error.
 * Resolves to the result, or null when the write failed.
 */
export function useTaskWrite() {
  const core = useCoreApi();
  const queryClient = useQueryClient();
  const itemsChanged = useItemsChanged();
  const refresh = useCallback(() => {
    // The shell's reads too: ⌘K's next write needs the version this one made.
    itemsChanged();
    return queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  }, [queryClient, itemsChanged]);
  const failed = useCallback(
    (err: unknown, verb: string) => {
      if (isConflict(err)) toast("Changed since");
      else toast(`Couldn't ${verb}`, { tone: "error" });
      void refresh();
    },
    [refresh],
  );

  return useCallback(
    async <T>({
      op,
      summary,
      verb,
      call,
      quiet,
    }: TaskWrite<T>): Promise<T | null> => {
      let res: { result: T; undo: UndoToken };
      try {
        res = await call();
      } catch (err) {
        failed(err, verb);
        return null;
      }
      void refresh();
      if (quiet) return res.result;
      // A write that changed nothing (completing a task already done) has
      // nothing to undo.
      const changed = res.undo.record != null || res.undo.created.length > 0;
      toast(summary, {
        tone: "success",
        timeout: UNDO_TOAST_MS,
        actions: !changed
          ? []
          : [
              {
                label: "Undo",
                onAction: () => {
                  core.ops.undo.mutate({ id: op, token: res.undo }).then(
                    ({ summary: undone }) => {
                      toast(undone);
                      void refresh();
                    },
                    (err: unknown) => failed(err, "undo"),
                  );
                },
              },
            ],
      });
      return res.result;
    },
    [core, refresh, failed],
  );
}
