import { toast } from "@dlh/ui";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useCoreApi, useItemsChanged } from "./index";

/** What a mutation hands back to undo it, as `ops.undo` takes it. */
export type UndoToken = Parameters<
  ReturnType<typeof useCoreApi>["ops"]["undo"]["mutate"]
>[0]["token"];

/** How long a write's toast keeps its Undo. */
export const UNDO_TOAST_MS = 10_000;

/** A write refused because the item changed since it was read. */
export function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: string } }).data?.code === "CONFLICT"
  );
}

/**
 * The undo token of a write's result, when it has one and the write changed
 * something. A write may run another module's operation, whose result may not
 * carry one.
 */
export function undoOf(res: unknown): UndoToken | null {
  if (typeof res !== "object" || res === null) return null;
  const undo = (res as { undo?: unknown }).undo;
  if (typeof undo !== "object" || undo === null) return null;
  const { record, created } = undo as { record?: unknown; created?: unknown };
  if (!Array.isArray(created) || !created.every((c) => typeof c === "string")) {
    return null;
  }
  // A write that changed nothing has nothing to undo.
  if (record == null && created.length === 0) return null;
  return { record, created };
}

export type ModuleWrite<T> = {
  /** The operation's id, as `ops.undo` takes it. */
  op: string;
  /** What the toast says, e.g. the operation's summary. */
  summary: string;
  /** What to call it in an error ("Couldn't complete"). */
  verb: string;
  /** Its result; `undo` is checked before Undo is offered. */
  call: () => Promise<{ result: T; undo?: unknown }>;
  /** No success toast, e.g. for notes saved as you type. Failures still toast. */
  quiet?: boolean;
};

export type ModuleWriteOptions = {
  /** The queries every write and undo refreshes. */
  queryKeys: readonly QueryKey[];
  /** What a conflict toasts, e.g. "Changed since". */
  conflictMessage: string;
};

/**
 * Runs a module's mutation: a success toast with Undo, then a refresh of
 * `queryKeys` and the shell's reads. A conflict toasts `conflictMessage` and
 * refetches; any other failure toasts an error. Resolves to the result, or
 * null when the write failed. Pass `options` as a constant, so the returned
 * function keeps its identity.
 */
export function useModuleWrite({
  queryKeys,
  conflictMessage,
}: ModuleWriteOptions) {
  const core = useCoreApi();
  const queryClient = useQueryClient();
  const itemsChanged = useItemsChanged();
  const refresh = useCallback(() => {
    // The shell's reads too: ⌘K's next write needs the version this one made.
    itemsChanged();
    return Promise.all(
      queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }, [queryClient, itemsChanged, queryKeys]);
  const failed = useCallback(
    (err: unknown, verb: string) => {
      if (isConflict(err)) toast(conflictMessage);
      else toast(`Couldn't ${verb}`, { tone: "error" });
      void refresh();
    },
    [refresh, conflictMessage],
  );

  return useCallback(
    async <T>({
      op,
      summary,
      verb,
      call,
      quiet,
    }: ModuleWrite<T>): Promise<T | null> => {
      let res: { result: T; undo?: unknown };
      try {
        res = await call();
      } catch (err) {
        failed(err, verb);
        return null;
      }
      void refresh();
      if (quiet) return res.result;
      const token = undoOf(res);
      toast(summary, {
        tone: "success",
        timeout: UNDO_TOAST_MS,
        actions: !token
          ? []
          : [
              {
                label: "Undo",
                onAction: () => {
                  core.ops.undo.mutate({ id: op, token }).then(
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
