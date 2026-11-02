import type { TRPCMutationProcedure, TRPCQueryProcedure } from "@trpc/server";
import type { z } from "zod";
import { protectedProcedure, router } from "../trpc";
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

function procedureFor(op: ImplementedOperation) {
  const p = protectedProcedure.input(op.desc.input);
  if (op.kind === "query") {
    return p.query(({ ctx, input }) => op.impl.run(ctx.deps, input));
  }
  return p.mutation(({ ctx, input }) => runMutation(ctx.deps, op, input));
}

/**
 * One protected procedure per operation under its key: a query, or a mutation
 * that returns `{ result, undo }` and writes through Core's scoped writer.
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
