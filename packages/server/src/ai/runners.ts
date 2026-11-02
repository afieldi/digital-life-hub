import type { AiActionDescription, AiKind, AiListedItem } from "@dlh/core";
import type { z } from "zod";
import { ServerModuleError } from "../modules";
import type { ImplementedMutation, UndoToken } from "../operations/implement";
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
  /** Reverts with the operation's own `undo`, as `ops.undo` does. */
  revert(op: ImplementedMutation, record: unknown): Promise<void>;
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
   * The undo record it returns is stored for `undo`. Items it creates, through
   * `w` or `tools.mutate`, are soft-deleted by Core before `undo` runs.
   */
  apply?(
    w: ScopedWriter,
    out: unknown,
    ctx: AiContext,
    tools?: RunnerTools,
  ): Promise<unknown>;
  undo?(w: ScopedWriter, record: unknown, tools?: RunnerTools): Promise<void>;
  summary?(out: unknown, ctx: AiContext): string;
  /** Ask only: answers with rows from the model's output, with no second call. */
  list?(
    deps: CoreDeps,
    out: unknown,
    ctx: AiContext,
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

export function defineAiRunner<D extends AiActionDescription>(
  action: D,
  rest: Omit<AiRunner<D>, "action">,
): AiRunner<D> {
  return { action, ...rest };
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
