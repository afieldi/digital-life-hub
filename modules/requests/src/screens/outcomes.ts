import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { z } from "zod";
import { type makeTaskParams, requestOps } from "../operations";
import type { RequestAction, RequestRow } from "../schema";
import {
  requestKeys,
  useRequestsApi,
  useRequestWrite,
  useRunRequestAction,
} from "./api";

export type MakeTaskParams = z.infer<typeof makeTaskParams>;

type OpenData = { heading: string; items: RequestRow[] };

/**
 * The writes a request's row and Detail offer: the three outcomes, its own
 * actions, and Reopen. Resolving takes the row out of Open at once; a failed
 * write's refresh puts it back.
 */
export function useOutcomes() {
  const requests = useRequestsApi();
  const write = useRequestWrite();
  const runAction = useRunRequestAction();
  const queryClient = useQueryClient();

  const drop = useCallback(
    (id: string) => {
      void queryClient.cancelQueries({ queryKey: requestKeys.open });
      queryClient.setQueryData<OpenData>(requestKeys.open, (old) =>
        old ? { ...old, items: old.items.filter((r) => r.id !== id) } : old,
      );
    },
    [queryClient],
  );

  const resolve = useCallback(
    (row: RequestRow, outcome: "handled" | "not_for_me") => {
      const input = { id: row.id, expectedUpdatedAt: row.updatedAt, outcome };
      drop(row.id);
      return write({
        op: requestOps.resolve.id,
        summary: requestOps.resolve.summary(input),
        verb: "resolve the request",
        call: () => requests.resolve.mutate(input),
      });
    },
    [requests, write, drop],
  );

  const makeTask = useCallback(
    (row: RequestRow, params: MakeTaskParams) => {
      const input = {
        id: row.id,
        expectedUpdatedAt: row.updatedAt,
        ...params,
      };
      drop(row.id);
      return write({
        op: requestOps.makeTask.id,
        summary: requestOps.makeTask.summary(input),
        verb: "make the task",
        call: () => requests.makeTask.mutate(input),
      });
    },
    [requests, write, drop],
  );

  const act = useCallback(
    (row: RequestRow, action: RequestAction) => {
      drop(row.id);
      return runAction(action);
    },
    [runAction, drop],
  );

  const reopen = useCallback(
    (row: RequestRow) => {
      const input = { id: row.id, expectedUpdatedAt: row.updatedAt };
      return write({
        op: requestOps.reopen.id,
        summary: requestOps.reopen.summary(input),
        verb: "reopen the request",
        call: () => requests.reopen.mutate(input),
      });
    },
    [requests, write],
  );

  return useMemo(
    () => ({ resolve, makeTask, act, reopen }),
    [resolve, makeTask, act, reopen],
  );
}
