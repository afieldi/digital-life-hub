import { queueVersioned as queueItemWrite } from "@dlh/client";
import { deviceTimeZone } from "@dlh/core";
import { toast } from "@dlh/ui";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { taskOps } from "../operations";
import type { TaskRow } from "../schema";
import { type TaskWrite, useTasksApi, useTaskWrite } from "./api";

/** The new version in a write's result: the item, or `complete`'s `task`. */
function versionIn(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as { updatedAt?: unknown; task?: { updatedAt?: unknown } };
  if (typeof r.updatedAt === "string") return r.updatedAt;
  return typeof r.task?.updatedAt === "string" ? r.task.updatedAt : undefined;
}

/**
 * Runs `run` for task `id` behind that task's other writes (screens' and
 * ⌘K's), with the newest version we know of, and remembers the version its
 * result carries.
 */
export function queueVersioned<T>(
  id: string,
  seen: string,
  run: (expectedUpdatedAt: string) => Promise<T>,
): Promise<T> {
  return queueItemWrite(id, seen, run, versionIn);
}

/**
 * A versioned write to one task: queued behind that task's other writes, sent
 * with the newest version we know of, through `useTaskWrite` (toast, Undo,
 * refresh). Resolves to the result, or null when it failed.
 */
export function useVersionedWrite() {
  const write = useTaskWrite();
  return useCallback(
    <T>(
      id: string,
      seen: string,
      make: (expectedUpdatedAt: string) => TaskWrite<T>,
    ): Promise<T | null> =>
      queueVersioned(id, seen, (version) => write(make(version))),
    [write],
  );
}

/** The Tasks cache shapes that hold rows: a list, a paged list, or `get`. */
type RowsData =
  | { rows: TaskRow[] }
  | { pages: { rows: TaskRow[] }[] }
  | { task: TaskRow; subtasks: TaskRow[] };

/** Every row in a cached Tasks query, whatever its shape. */
export function rowsIn(data: unknown): TaskRow[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Partial<Record<string, unknown>>;
  if (Array.isArray(d.rows)) return d.rows as TaskRow[];
  if (Array.isArray(d.pages)) {
    return (d.pages as { rows: TaskRow[] }[]).flatMap((p) => p.rows);
  }
  if (d.task) return [d.task as TaskRow, ...((d.subtasks as TaskRow[]) ?? [])];
  return [];
}

/** The same cached data with `fn` applied to each row. */
export function mapRows<D>(data: D, fn: (row: TaskRow) => TaskRow): D {
  if (!data || typeof data !== "object") return data;
  const d = data as unknown as RowsData;
  if ("rows" in d) return { ...d, rows: d.rows.map(fn) } as D;
  if ("pages" in d) {
    return {
      ...d,
      pages: d.pages.map((p) => ({ ...p, rows: p.rows.map(fn) })),
    } as D;
  }
  if ("task" in d) {
    return { ...d, task: fn(d.task), subtasks: d.subtasks.map(fn) } as D;
  }
  return data;
}

/** Reads and changes rows in one cached Tasks query. */
export function useRowCache(queryKey: QueryKey) {
  const queryClient = useQueryClient();
  const keyText = JSON.stringify(queryKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by its text so a new array each render is the same key
  const cachedRow = useCallback(
    (id: string) =>
      rowsIn(queryClient.getQueryData(queryKey)).find((r) => r.id === id),
    [queryClient, keyText],
  );
  /**
   * Changes a cached row now. A tick (`optimistic`) first cancels a refetch
   * already on its way, which would put the old state back; a version from a
   * write's result leaves that write's own refresh running.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const patchRow = useCallback(
    (id: string, patch: Partial<TaskRow>, optimistic = false) => {
      if (optimistic) void queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, (old: unknown) =>
        mapRows(old, (r) => (r.id === id ? { ...r, ...patch } : r)),
      );
    },
    [queryClient, keyText],
  );
  return useMemo(() => ({ cachedRow, patchRow }), [cachedRow, patchRow]);
}

export type RowCache = ReturnType<typeof useRowCache>;

/**
 * Ticking and unticking rows held in `cache`. The tick shows at once; when it
 * leaves all of a parent's subtasks done, a toast offers to complete that
 * parent too.
 */
export function useTaskToggle({ cachedRow, patchRow }: RowCache) {
  const tasks = useTasksApi();
  const send = useVersionedWrite();

  const complete = useCallback(
    (id: string, seen: string) =>
      send(id, seen, (expectedUpdatedAt) => {
        const input = { id, expectedUpdatedAt };
        return {
          op: taskOps.complete.id,
          summary: taskOps.complete.summary(input),
          verb: "complete the task",
          call: () => tasks.complete.mutate(input),
        };
      }),
    [tasks, send],
  );

  const reopen = useCallback(
    (id: string, seen: string) =>
      send(id, seen, (expectedUpdatedAt) => {
        const input = { id, expectedUpdatedAt };
        return {
          op: taskOps.reopen.id,
          summary: taskOps.reopen.summary(input),
          verb: "reopen the task",
          call: () => tasks.reopen.mutate(input),
        };
      }),
    [tasks, send],
  );

  const completeParent = useCallback(
    async (id: string) => {
      try {
        const { task } = await tasks.get.query({
          id,
          timeZone: deviceTimeZone(),
        });
        await complete(task.id, task.updatedAt);
      } catch {
        toast("Couldn't complete the task", { tone: "error" });
      }
    },
    [tasks, complete],
  );

  const toggle = useCallback(
    (row: TaskRow) => {
      const current = cachedRow(row.id) ?? row;
      const done = current.completedAt === null;
      patchRow(
        row.id,
        { completedAt: done ? new Date().toISOString() : null },
        true,
      );
      if (!done) {
        void reopen(row.id, current.updatedAt).then((item) => {
          if (item) patchRow(row.id, { updatedAt: item.updatedAt });
        });
        return;
      }
      void complete(row.id, current.updatedAt).then((res) => {
        if (!res) return;
        patchRow(row.id, { updatedAt: res.task.updatedAt });
        for (const parent of res.parentsNowDone) {
          toast("All subtasks done. Complete the task?", {
            actions: [
              {
                label: "Complete",
                onAction: () => void completeParent(parent.id),
              },
            ],
          });
        }
      });
    },
    [cachedRow, patchRow, complete, reopen, completeParent],
  );

  return { toggle, complete, reopen };
}
