import { accessOf, type OperationAccess } from "@dlh/core";
import {
  TRPCError,
  type TRPCMutationProcedure,
  type TRPCQueryProcedure,
} from "@trpc/server";
import type { z } from "zod";
import { type Principal, publicProcedure, router } from "../trpc";
import {
  type ImplementedOperation,
  type Operations,
  runMutation,
  type UndoToken,
} from "./implement";

/** The tRPC procedure an operation becomes, typed from its description and impl. */
export type OperationProcedure<Op> =
  Op extends ImplementedOperation<infer D, infer O>
    ? Op["kind"] extends "mutation"
      ? TRPCMutationProcedure<{
          input: z.input<D["input"]>;
          output: { result: O; undo: UndoToken };
          meta: object;
        }>
      : TRPCQueryProcedure<{
          input: z.input<D["input"]>;
          output: O;
          meta: object;
        }>
    : never;

export type OperationsRouter<T extends Operations> = ReturnType<
  typeof router<{ [K in keyof T]: OperationProcedure<T[K]> }>
>;

/** The principals each `access` lets in. */
const ALLOWED: Record<OperationAccess, ReadonlySet<Principal["kind"]>> = {
  everyone: new Set(["user", "run"]),
  user: new Set(["user"]),
  worker: new Set(["worker"]),
  slack: new Set(["slack"]),
};

/** No principal is UNAUTHORIZED; one `access` doesn't let in is FORBIDDEN. */
function accessProcedure(access: OperationAccess) {
  const allowed = ALLOWED[access];
  return publicProcedure.use(({ ctx, next }) => {
    if (!ctx.principal) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (!allowed.has(ctx.principal.kind)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next();
  });
}

function procedureFor(op: ImplementedOperation) {
  const p = accessProcedure(accessOf(op.desc)).input(op.desc.input);
  if (op.kind === "query") {
    return p.query(({ ctx, input }) => op.impl.run(ctx.deps, input));
  }
  return p.mutation(({ ctx, input }) => runMutation(ctx.deps, op, input));
}

/**
 * One procedure per operation under its key, open to the callers its `access`
 * allows: a query, or a mutation that returns `{ result, undo }` and writes
 * through Core's scoped writer.
 */
export function operationsRouter<T extends Operations>(
  ops: T,
): OperationsRouter<T> {
  const procedures = Object.fromEntries(
    Object.entries(ops).map(([key, op]) => [key, procedureFor(op)]),
  );
  // The procedures are built at runtime; their types come from `T`.
  return router(procedures) as unknown as OperationsRouter<T>;
}
