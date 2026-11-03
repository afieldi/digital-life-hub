import {
  type ModuleWriteOptions,
  useCoreApi,
  useModuleApi,
  useModuleWrite,
} from "@dlh/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Outcome, RequestAction } from "../schema";
import type { RequestsRouter } from "../server";

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

/** What a Queue write refreshes, and what a conflict says. */
const REQUEST_WRITE: ModuleWriteOptions = {
  queryKeys: [REQUESTS_KEY, TASKS_KEY],
  conflictMessage: "It changed elsewhere; try again",
};

/**
 * Runs a Queue mutation: a success toast with Undo, then a refresh of the
 * Queue's and Tasks' reads. A conflict toasts "It changed elsewhere; try
 * again" and refetches; any other failure toasts an error. Resolves to the
 * result, or null when the write failed.
 */
export function useRequestWrite() {
  return useModuleWrite(REQUEST_WRITE);
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
