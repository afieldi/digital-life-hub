import type { AiActionDescription, AiKind, AiListedItem } from "@dlh/core";
import { z } from "zod";
import { ServerModuleError } from "../modules";
import type { ImplementedMutation, UndoToken } from "../operations/implement";
import type { undoToken } from "../operations/undo";
import type { CoreDeps } from "../trpc";
import type { AiContext } from "./context";
import type { ScopedWriter } from "./scoped";

/**
 * Core's operation plumbing, bound to the request's transaction, for runners
 * that run a module operation rather than writing through `w` themselves.
 */
export type RunnerTools = {
  /** Runs a mutation as `ops` does: its own scoped writer, created items tracked. */
  mutate(
    op: ImplementedMutation,
    input: Record<string, unknown>,
  ): Promise<{ result: unknown; undo: UndoToken }>;
  /**
   * Reverts as `ops.undo` does: the operation's own `undo`, then those of the
   * operations it called, then the items in `created`. A bare `{ record }`
   * reverts only the operation.
   */
  revert(
    op: ImplementedMutation,
    token: Partial<z.input<typeof undoToken>>,
  ): Promise<void>;
};

/** A title the model gave, replaced by an item id or offered as options. */
export type Resolved =
  | { out: unknown }
  | { options: { label: string; out: unknown }[] };

export type AiRunner<D extends AiActionDescription = AiActionDescription> = {
  action: D;
  /** `timeZone` is the device's IANA zone, when the app sent one. */
  context(
    deps: CoreDeps,
    itemId: string | null,
    opts?: { timeZone?: string },
  ): Promise<AiContext>;
  system: string;
  output: Partial<Record<AiKind, z.ZodType>>;
  /**
   * What the scripted dev and e2e fake answers, for an output it can't guess
   * from the schema's shape (a hand-written action's own). `suggest` is true
   * for the suggest kind's `{ options }`.
   */
  devFake?(req: { prompt: string; suggest: boolean }): unknown;
  /**
   * The undo record it returns is stored for `undo`. Items it creates, through
   * `w` or `tools.mutate`, are soft-deleted by Core before `undo` runs.
   */
  apply?(
    w: ScopedWriter,
    out: unknown,
    ctx: AiContext,
    tools: RunnerTools,
  ): Promise<unknown>;
  undo?(w: ScopedWriter, record: unknown, tools: RunnerTools): Promise<void>;
  summary?(out: unknown, ctx: AiContext): string;
  /** Ask only: answers with rows from the model's output, with no second call. */
  list?(
    deps: CoreDeps,
    out: unknown,
    /**
     * The request's zone, and the ids its context listed to the model at
     * prepare (`AiContext.listed`): not a fresh context, which may have
     * changed (or lost its item) during a slow CLI run.
     */
    req: { timeZone?: string; listed?: string[] },
  ): Promise<{ heading: string; items: AiListedItem[] }>;
  /**
   * Text shown under a suggested option's label, such as the rewritten text
   * it would apply. Defaults to the option's `reason`.
   */
  preview?(option: Record<string, unknown>): string | undefined;
  /** Set by `operationAiRunner` for a mutation, whose tagged undo record lists what it created. */
  operation?: ImplementedMutation;
  /**
   * Before suggesting or applying: turns what the model named into ids, and
   * local times into instants in `timeZone` (the device's, when sent).
   */
  resolve?(
    deps: CoreDeps,
    out: unknown,
    opts?: { timeZone?: string },
  ): Promise<Resolved>;
};

/** A runner's output schemas, one per kind it runs as. */
export type AiOutputs = Partial<Record<AiKind, z.ZodType>>;

/** What the `kind` schema parses to; never when the runner has none. */
type OutputOf<O extends AiOutputs, K extends AiKind> = O extends {
  [P in K]: infer S extends z.ZodType;
}
  ? z.infer<S>
  : never;

/** One option of the suggest output, `{ options: Option[] }`. */
export type SuggestOption<O extends AiOutputs> = O extends {
  suggest: z.ZodType<{ options: (infer T)[] }>;
}
  ? T
  : never;

/**
 * What `apply` and `summary` get: do's output, the chosen suggest option, or
 * for a `multiSelect` action the chosen options together.
 */
export type AppliedOut<D, O extends AiOutputs> =
  | OutputOf<O, "do">
  | SuggestOption<O>
  | (D extends { multiSelect: true } ? SuggestOption<O>[] : never);

/**
 * `AiRunner` with its model output and undo record typed. The gateway parses
 * the output with `output` before any of these run; `undoRecord`, when given,
 * parses the stored record before `undo` gets it. A runner with `resolve`
 * applies what `resolve` returned instead, so it should keep `apply` loose.
 */
export type TypedAiRunner<
  D extends AiActionDescription,
  O extends AiOutputs,
  U,
> = Omit<
  AiRunner<D>,
  "action" | "output" | "apply" | "undo" | "summary" | "list" | "preview"
> & {
  output: O;
  apply?(
    w: ScopedWriter,
    out: AppliedOut<D, O>,
    ctx: AiContext,
    tools: RunnerTools,
  ): Promise<U>;
  /** Checks the record `apply` returned once it comes back from the database. */
  undoRecord?: z.ZodType<U>;
  undo?(w: ScopedWriter, record: U, tools: RunnerTools): Promise<void>;
  summary?(out: AppliedOut<D, O>, ctx: AiContext): string;
  list?(
    deps: CoreDeps,
    out: OutputOf<O, "ask">,
    req: { timeZone?: string; listed?: string[] },
  ): Promise<{ heading: string; items: AiListedItem[] }>;
  preview?(option: SuggestOption<O>): string | undefined;
};

export function defineAiRunner<
  D extends AiActionDescription,
  O extends AiOutputs,
  U = unknown,
>(action: D, rest: TypedAiRunner<D, O, U>): AiRunner<D> {
  const { undoRecord, undo, ...typed } = rest;
  // The gateway checks outputs against `output` before calling these, so
  // widening their parameters back to `unknown` is safe.
  const runner = { action, ...typed } as AiRunner<D>;
  if (undo) {
    runner.undo = async (w, record, tools) =>
      undo.call(
        runner,
        w,
        undoRecord ? undoRecord.parse(record) : (record as U),
        tools,
      );
  }
  return runner;
}

/**
 * A suggest output: `{ options }`, each option `option` with nothing extra.
 * `count` is how many the model must give, exactly or as a range.
 */
export function suggestOptions<S extends z.ZodRawShape>(
  option: z.ZodObject<S>,
  count: number | { min: number; max: number },
) {
  const options = z.array(option.strict());
  return z
    .object({
      options:
        typeof count === "number"
          ? options.length(count)
          : options.min(count.min).max(count.max),
    })
    .strict();
}

/**
 * Checks an AI action's or operation's id prefix and `appliesTo` against `mod`,
 * the module that registered it (`undefined` for Core: no prefix, and only
 * "*"/"none").
 */
export function checkModuleAction(
  noun: "AI action" | "Operation",
  d: Pick<AiActionDescription, "id" | "appliesTo">,
  mod: string | undefined,
  ownedTypes: Map<string, string>,
): void {
  if (mod === undefined) {
    if (d.id.includes(".")) {
      throw new ServerModuleError(
        `${noun} "${d.id}" has a module prefix but no module registered it`,
      );
    }
  } else if (!d.id.startsWith(`${mod}.`)) {
    throw new ServerModuleError(
      `${noun} "${d.id}" must be prefixed with its module id "${mod}."`,
    );
  }
  const applies = Array.isArray(d.appliesTo) ? d.appliesTo : [d.appliesTo];
  for (const t of applies) {
    if (t === "*" || t === "none") continue;
    if (mod === undefined || ownedTypes.get(t) !== mod) {
      throw new ServerModuleError(
        `${noun} "${d.id}" applies to item type "${t}" that its module does not own`,
      );
    }
  }
}

/**
 * Pairs descriptions with runners and checks each against its module.
 * Core actions (no module in `moduleOf`) have unprefixed ids and may only use "*"/"none".
 */
export function collectAiRunners(
  descriptions: AiActionDescription[],
  runners: AiRunner[],
  moduleOf: Map<string, string>,
  ownedTypes: Map<string, string>,
): Map<string, AiRunner> {
  const byId = new Map<string, AiRunner>();
  for (const r of runners) {
    if (byId.has(r.action.id)) {
      throw new ServerModuleError(`Duplicate AI runner "${r.action.id}"`);
    }
    byId.set(r.action.id, r);
  }
  const seen = new Set<string>();
  for (const d of descriptions) {
    if (seen.has(d.id)) {
      throw new ServerModuleError(`Duplicate AI action "${d.id}"`);
    }
    seen.add(d.id);
    checkModuleAction("AI action", d, moduleOf.get(d.id), ownedTypes);
    if (!byId.has(d.id)) {
      throw new ServerModuleError(`AI action "${d.id}" has no runner`);
    }
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) {
      throw new ServerModuleError(
        `AI runner "${id}" has no action description`,
      );
    }
  }
  return byId;
}
