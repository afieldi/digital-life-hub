import { type OperationDescription, OperationError } from "@dlh/core";
import type { Db } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { type ScopedWriter, scopedWriter } from "../ai/scoped";
import { type ItemWriter, writeItems } from "../items/writer";
import type { CoreDeps } from "../trpc";

/** What `ops.undo` needs to revert a mutation: its record and the items it created. */
export type UndoToken = { record: unknown; created: string[] };

/**
 * A mutation's server half. `run` writes through the scoped writer and returns
 * its result and an undo record; `undo` reverts with a record that passed
 * `undoRecord`. Items `run` created are soft-deleted by Core before `undo` runs.
 */
export type MutationImpl<I, O, U> = {
  run(
    w: ScopedWriter,
    input: I,
    deps: CoreDeps,
  ): Promise<{ result: O; undo: U }>;
  undo(w: ScopedWriter, record: U, deps: CoreDeps): Promise<void>;
  undoRecord: z.ZodType<U>;
};

/** A query's server half: a read with no writer. */
export type QueryImpl<I, O> = { run(deps: CoreDeps, input: I): Promise<O> };

type InputOf<D extends OperationDescription> = z.output<D["input"]>;

export type ImplementedMutation<
  D extends OperationDescription = OperationDescription,
  O = unknown,
> = {
  kind: "mutation";
  desc: D;
  impl: MutationImpl<InputOf<D>, O, unknown>;
};

export type ImplementedQuery<
  D extends OperationDescription = OperationDescription,
  O = unknown,
> = { kind: "query"; desc: D; impl: QueryImpl<InputOf<D>, O> };

/** An operation's description with its server implementation. */
export type ImplementedOperation<
  D extends OperationDescription = OperationDescription,
  O = unknown,
> = ImplementedMutation<D, O> | ImplementedQuery<D, O>;

export type Operations = Record<string, ImplementedOperation>;

/** Pairs a description with its implementation; the impl's shape must match `desc.kind`. */
export function implementOperation<D extends OperationDescription, O, U>(
  desc: D,
  impl: MutationImpl<InputOf<D>, O, U>,
): ImplementedMutation<D, O>;
export function implementOperation<D extends OperationDescription, O>(
  desc: D,
  impl: QueryImpl<InputOf<D>, O>,
): ImplementedQuery<D, O>;
export function implementOperation(
  desc: OperationDescription,
  impl: MutationImpl<unknown, unknown, unknown> | QueryImpl<unknown, unknown>,
): ImplementedOperation {
  const op: ImplementedOperation =
    "undoRecord" in impl
      ? { kind: "mutation", desc, impl }
      : { kind: "query", desc, impl };
  if (op.kind !== desc.kind) {
    throw new OperationError(
      `Operation "${desc.id}" is a ${desc.kind} but is implemented as a ${op.kind}`,
    );
  }
  return op;
}

/**
 * Runs a mutation in `w`'s transaction with Core's scoped writer: only the
 * methods its effects allow, on `subject(input)` unless it declares
 * `writeOtherItems`. The token lists the items it created, including those
 * created by operations it called; a callee's own undo record is dropped, so
 * `ops.undo` soft-deletes its items and the caller's `undo` reverses the rest.
 */
export async function runMutationIn<D extends OperationDescription, O>(
  w: ItemWriter,
  deps: CoreDeps,
  op: ImplementedMutation<D, O>,
  input: InputOf<D>,
): Promise<{ result: O; undo: UndoToken }> {
  const created: string[] = [];
  const scoped = scopedWriter(w, {
    effects: op.desc.effects,
    itemId: op.desc.subject(input),
    created,
  });
  if (op.desc.calls?.length) {
    const declared = new Set(op.desc.calls.map((c) => c.id));
    scoped.call = async (callee, calleeInput) => {
      const registered = deps.operations.get(callee.id);
      if (!declared.has(callee.id) || !registered) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Call outside the declared calls",
        });
      }
      const parsed = registered.desc.input.safeParse(calleeInput);
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: parsed.error.message,
          cause: parsed.error,
        });
      }
      if (registered.kind === "query") {
        // A Tx lacks only Db's `$client`, which queries don't use; this transaction lets them see the caller's uncommitted writes.
        return registered.impl.run(
          { ...deps, db: w.tx as unknown as Db },
          parsed.data,
        );
      }
      const calleeScope = scopedWriter(w, {
        effects: registered.desc.effects,
        itemId: registered.desc.subject(parsed.data),
        created,
      });
      const { result } = await registered.impl.run(
        calleeScope,
        parsed.data,
        deps,
      );
      return result;
    };
  }
  const { result, undo } = await op.impl.run(scoped, input, deps);
  return { result, undo: { record: undo, created } };
}

/** `runMutationIn`, in a transaction of its own. */
export async function runMutation<D extends OperationDescription, O>(
  deps: CoreDeps,
  op: ImplementedMutation<D, O>,
  input: InputOf<D>,
): Promise<{ result: O; undo: UndoToken }> {
  return writeItems(deps, (w) => runMutationIn(w, deps, op, input));
}
