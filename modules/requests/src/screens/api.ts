import { useCoreApi, useItemsChanged, useModuleApi } from "@dlh/client";
import { toast } from "@dlh/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Outcome, RequestAction } from "../schema";
import type { RequestsRouter } from "../server";

/** What a mutation hands back to undo it, as `ops.undo` takes it. */
type UndoToken = Parameters<
  ReturnType<typeof useCoreApi>["ops"]["undo"]["mutate"]
>[0]["token"];

/** The `requests` module router, typed. */
export function useRequestsApi() {
  return useModuleApi<RequestsRouter>("requests");
}

/** Every Queue query key starts here, so one invalidation refreshes them all. */
export const REQUESTS_KEY = ["requests"] as const;

/** Tasks' keys: a made task shows in its lists without waiting for the stream. */
const TASKS_KEY = ["tasks"] as const;

export const requestKeys = {
  open: [...REQUESTS_KEY, "open"] as const,
  resolved: (outcome: Outcome | undefined) =>
    [...REQUESTS_KEY, "resolved", outcome ?? "all"] as const,
  get: (id: string) => [...REQUESTS_KEY, "get", id] as const,
};

/** How long a write's toast keeps its Undo. */
export const UNDO_TOAST_MS = 10_000;

/** A request's page: the Detail panel. */
export const requestHref = (id: string) => `/queue/${id}`;

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The open requests, oldest first: Open and the nav count share this read. */
export function useOpenRequests() {
  const requests = useRequestsApi();
  return useQuery({
    queryKey: requestKeys.open,
    queryFn: () => requests.open.query({}),
  });
}

/** A write refused because the request changed since it was read. */
export function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: string } }).data?.code === "CONFLICT"
  );
}

/**
 * The undo token of a write's result, when it has one and the write changed
 * something. A request's action runs another module's operation, whose result
 * may not carry one.
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

export type RequestWrite<T> = {
  /** The operation's id, as `ops.undo` takes it. */
  op: string;
  /** What the toast says, e.g. the operation's summary. */
  summary: string;
  /** What to call it in an error ("Couldn't resolve the request"). */
  verb: string;
  /** Its result; `undo` is checked before Undo is offered. */
  call: () => Promise<{ result: T; undo?: unknown }>;
};

/**
 * Runs a Queue mutation: a success toast with Undo, then a refresh of the
 * Queue's and Tasks' reads. A conflict toasts "It changed elsewhere; try
 * again" and refetches; any other failure toasts an error. Resolves to the
 * result, or null when the write failed.
 */
export function useRequestWrite() {
  const core = useCoreApi();
  const queryClient = useQueryClient();
  const itemsChanged = useItemsChanged();
  const refresh = useCallback(() => {
    // The shell's reads too: ⌘K's next write needs the version this one made.
    itemsChanged();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }),
      queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
    ]);
  }, [queryClient, itemsChanged]);
  const failed = useCallback(
    (err: unknown, verb: string) => {
      if (isConflict(err)) toast("It changed elsewhere; try again");
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
    }: RequestWrite<T>): Promise<T | null> => {
      let res: { result: T; undo?: unknown };
      try {
        res = await call();
      } catch (err) {
        failed(err, verb);
        return null;
      }
      void refresh();
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

/** A module router as `runRequestAction` reaches it: mutations by name. */
type AnyModuleRouter = Record<
  string,
  { mutate?: (input: unknown) => Promise<{ result: unknown; undo?: unknown }> }
>;

/**
 * Runs one of a request's own actions (`{ label, operation, input }`): the
 * operation `module.key` is called on that module's router, with the same
 * toast and Undo as the outcomes.
 */
export function useRunRequestAction() {
  // The modules' routers sit beside Core's on the one client.
  const client = useCoreApi() as unknown as Record<string, AnyModuleRouter>;
  const write = useRequestWrite();
  return useCallback(
    (action: RequestAction) => {
      const [moduleId = "", key = ""] = action.operation.split(".");
      const mutate = client[moduleId]?.[key]?.mutate;
      return write({
        op: action.operation,
        summary: action.label,
        verb: action.label.toLowerCase(),
        call: () =>
          mutate
            ? mutate(action.input)
            : Promise.reject(new Error(`No operation ${action.operation}`)),
      });
    },
    [client, write],
  );
}
