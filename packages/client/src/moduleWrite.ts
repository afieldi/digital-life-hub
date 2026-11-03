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

/**
 * What went wrong with an API call, as a screen reacts to it:
 * - `conflict`: the item changed since it was read; reload and try again.
 * - `gone`: it doesn't exist (deleted elsewhere); retrying can't help.
 * - `invalid`: the server refused the input; its message says why.
 * - `forbidden` / `unauthorized`: not allowed, or signed out.
 * - `network`: no answer from the server; it may work later.
 * - `server`: the server failed (or the app threw); it may work later.
 */
export type ApiErrorKind =
  | "conflict"
  | "gone"
  | "invalid"
  | "forbidden"
  | "unauthorized"
  | "network"
  | "server";

/** The tRPC error code an API failure carries, if any. */
function codeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("data" in err)) return;
  const { data } = err;
  if (typeof data !== "object" || data === null || !("code" in data)) return;
  return typeof data.code === "string" ? data.code : undefined;
}

export function apiErrorKind(err: unknown): ApiErrorKind {
  switch (codeOf(err)) {
    case "CONFLICT":
      return "conflict";
    case "NOT_FOUND":
      return "gone";
    case "BAD_REQUEST":
    case "PARSE_ERROR":
    case "UNPROCESSABLE_CONTENT":
    case "PAYLOAD_TOO_LARGE":
    case "PRECONDITION_FAILED":
      return "invalid";
    case "FORBIDDEN":
      return "forbidden";
    case "UNAUTHORIZED":
      return "unauthorized";
    case undefined:
      // A tRPC error with no code never reached the server.
      return err instanceof Error && err.name === "TRPCClientError"
        ? "network"
        : "server";
    default:
      return "server";
  }
}

/** Whether trying the same call again may work: no answer, or a server failure. */
export function isTransient(err: unknown): boolean {
  const kind = apiErrorKind(err);
  return kind === "network" || kind === "server";
}

/**
 * The server's own words for a refused input ("title must be 1 to 500
 * characters"), else `fallback`. A schema failure's message is the raw issue
 * list, so it gets the fallback too.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (apiErrorKind(err) !== "invalid" || !(err instanceof Error)) {
    return fallback;
  }
  const message = err.message.trim();
  return message && !message.startsWith("[") ? message : fallback;
}

/** A write refused because the item changed since it was read. */
export function isConflict(err: unknown): boolean {
  return apiErrorKind(err) === "conflict";
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
  /** Called with what went wrong when the write fails, after the toast. */
  onError?: (kind: ApiErrorKind) => void;
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
    (err: unknown, verb: string): ApiErrorKind => {
      const kind = apiErrorKind(err);
      if (kind === "conflict") toast(conflictMessage);
      else if (kind === "gone") {
        toast(`Couldn't ${verb}: it was deleted`, { tone: "error" });
      } else {
        const why = apiErrorMessage(err, "");
        toast(`Couldn't ${verb}${why ? `: ${why}` : ""}`, { tone: "error" });
      }
      void refresh();
      return kind;
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
      onError,
    }: ModuleWrite<T>): Promise<T | null> => {
      let res: { result: T; undo?: unknown };
      try {
        res = await call();
      } catch (err) {
        // Not `onError?.(failed(...))`: that skips `failed` without an onError.
        const kind = failed(err, verb);
        onError?.(kind);
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
