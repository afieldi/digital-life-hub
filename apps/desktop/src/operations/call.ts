import type { AppRouter } from "@dlh/api/router";
import type { OperationDescription } from "@dlh/core";
import { type TRPCClient, TRPCClientError } from "@trpc/client";

type Client = TRPCClient<AppRouter>;

/** What a mutation hands back to undo it, as `ops.undo` takes it. */
export type UndoToken = Parameters<Client["ops"]["undo"]["mutate"]>[0]["token"];

type Procedure = {
  query: (input: unknown) => Promise<unknown>;
  mutate: (input: unknown) => Promise<unknown>;
};

/**
 * Calls the module procedure behind `op` (mounted as `<module>.<key>`, the
 * same path as its id). A query returns its result; a mutation returns
 * `{ result, undo }`.
 */
export function callOperation(
  client: Client,
  op: OperationDescription,
  input: unknown,
): Promise<unknown> {
  const [moduleId, key] = op.id.split(".");
  if (!moduleId || !key) {
    return Promise.reject(new Error(`Operation "${op.id}" has no module`));
  }
  // The one untyped step: the operation is picked at runtime from the
  // registry, so its procedure is looked up by its id rather than named.
  const procedure = (
    client as unknown as Record<string, Record<string, Procedure> | undefined>
  )[moduleId]?.[key];
  if (!procedure) {
    return Promise.reject(new Error(`No procedure for "${op.id}"`));
  }
  return op.kind === "query" ? procedure.query(input) : procedure.mutate(input);
}

/** Reverts a mutation; resolves to what was undone ("Undid complete"). */
export async function undoOperation(
  client: Client,
  id: string,
  token: UndoToken,
): Promise<string> {
  const { summary } = await client.ops.undo.mutate({ id, token });
  return summary;
}

/** A write refused because the item changed since it was read. */
export function isConflict(err: unknown): err is TRPCClientError<AppRouter> {
  return err instanceof TRPCClientError && err.data?.code === "CONFLICT";
}

/** Whether a mutation's result carries an `undo` token to send back to `ops.undo`. */
export function hasUndo(res: unknown): res is { undo: UndoToken } {
  if (typeof res !== "object" || res === null || !("undo" in res)) {
    return false;
  }
  const { undo } = res;
  return (
    typeof undo === "object" &&
    undo !== null &&
    "created" in undo &&
    Array.isArray(undo.created)
  );
}
