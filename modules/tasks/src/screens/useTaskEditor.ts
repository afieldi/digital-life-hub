import { useCallback, useEffect, useRef, useState } from "react";
import { dayOfDue } from "../dates";
import { taskOps } from "../operations";
import type { Due, Priority } from "../schema";
import { deviceTimeZone, useTasksApi } from "./api";
import { type RowCache, useVersionedWrite } from "./rowWrites";

/** The fields the Detail panel edits in place. */
export type TaskEdits = {
  due?: Due | null;
  priority?: Priority;
  notes?: string | null;
};

/** How long typing pauses before an edit is saved. */
export const SAVE_PAUSE_MS = 500;

/**
 * Edits to one task, saved with `update` after a pause in typing (or at once
 * with `now`), always with the newest version. `draft` holds what is shown
 * until the save is back; a refused save keeps it and is sent again once the
 * task is reloaded (and with the next edit after that). Unmounting saves what is still waiting. Notes save
 * quietly; a due or priority change toasts with Undo.
 */
export function useTaskEditor(
  id: string,
  cache: RowCache,
  /** Reloads the task, for the version to retry a refused save with. */
  reload: () => Promise<unknown>,
) {
  const tasks = useTasksApi();
  const send = useVersionedWrite();
  const [draft, setDraft] = useState<TaskEdits>({});
  const waiting = useRef<TaskEdits>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushRef = useRef<(retry?: boolean) => void>(() => {});
  const flush = useCallback(
    (retry = false) => {
      clearTimeout(timer.current);
      timer.current = undefined;
      const fields = waiting.current;
      waiting.current = {};
      const row = cache.cachedRow(id);
      if (!row || Object.keys(fields).length === 0) return;
      const quiet = Object.keys(fields).every((k) => k === "notes");
      void send(id, row.updatedAt, (expectedUpdatedAt) => {
        const input = { id, expectedUpdatedAt, ...fields };
        return {
          op: taskOps.update.id,
          summary: taskOps.update.summary(input),
          verb: "save the task",
          call: () => tasks.update.mutate(input),
          quiet,
        };
      }).then(async (item) => {
        if (!item) {
          // Refused (changed since, or failed): what the person typed stays on
          // screen and waits to be sent again, behind anything typed since.
          waiting.current = { ...fields, ...waiting.current };
          if (retry) return;
          // Once, with the version the reload brings; else at the next edit.
          await reload().catch(() => {});
          flushRef.current(true);
          return;
        }
        cache.patchRow(id, {
          updatedAt: item.updatedAt,
          ...fields,
          ...(fields.due !== undefined
            ? { day: dayOfDue(fields.due, deviceTimeZone()) }
            : {}),
        });
        // What was saved now shows from the task, unless it changed again.
        setDraft((d) => {
          const next = { ...d };
          for (const k of Object.keys(fields) as (keyof TaskEdits)[]) {
            if (next[k] === fields[k]) delete next[k];
          }
          return next;
        });
      });
    },
    [id, cache, send, tasks, reload],
  );
  flushRef.current = flush;

  const edit = useCallback(
    (fields: TaskEdits, { now = false }: { now?: boolean } = {}) => {
      setDraft((d) => ({ ...d, ...fields }));
      waiting.current = { ...waiting.current, ...fields };
      clearTimeout(timer.current);
      if (now) flush();
      else timer.current = setTimeout(() => flush(), SAVE_PAUSE_MS);
    },
    [flush],
  );

  // Leaving the panel saves what is still waiting.
  useEffect(() => () => flushRef.current(), []);

  return { draft, edit };
}
