import type { ApiErrorKind } from "@dlh/client";
import { dayOfDue, deviceTimeZone } from "@dlh/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { taskOps } from "../operations";
import type { Due, Priority } from "../schema";
import { useTasksApi } from "./api";
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
 * until the save is back. A save refused because the task changed is sent
 * again once the task is reloaded; one that failed to arrive waits for the
 * next edit; one for a deleted task is dropped; one the server refused keeps
 * the draft without sending it again on its own. Unmounting saves what is
 * still waiting. Notes save quietly; a due or priority change toasts with Undo.
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
      let failure: ApiErrorKind | undefined;
      void send(id, row.updatedAt, (expectedUpdatedAt) => {
        const input = { id, expectedUpdatedAt, ...fields };
        return {
          op: taskOps.update.id,
          summary: taskOps.update.summary(input),
          verb: "save the task",
          call: () => tasks.update.mutate(input),
          quiet,
          onError: (kind) => {
            failure = kind;
          },
        };
      }).then(async (item) => {
        if (!item) {
          if (failure === "gone") {
            // Deleted elsewhere: nothing to save it to.
            setDraft({});
            return;
          }
          // What the person typed stays on screen and waits to be sent
          // again, behind anything typed since: with the next edit.
          waiting.current = { ...fields, ...waiting.current };
          if (failure !== "conflict" || retry) return;
          // Changed since: once more, with the version the reload brings.
          const reloaded = await reload().then(
            () => true,
            () => false,
          );
          if (reloaded) flushRef.current(true);
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
