import type { AiActionDescription, AiKind } from "@dlh/core";
import type { z } from "zod";
import { ServerModuleError } from "../modules";
import type { CoreDeps } from "../trpc";
import type { AiContext } from "./context";
import type { ScopedWriter } from "./scoped";

export type AiRunner<D extends AiActionDescription = AiActionDescription> = {
  action: D;
  context(deps: CoreDeps, itemId: string | null): Promise<AiContext>;
  system: string;
  output: Partial<Record<AiKind, z.ZodType>>;
  apply?(w: ScopedWriter, out: unknown, ctx: AiContext): Promise<unknown>;
  undo?(w: ScopedWriter, record: unknown): Promise<void>;
  summary?(out: unknown, ctx: AiContext): string;
};

export function defineAiRunner<D extends AiActionDescription>(
  action: D,
  rest: Omit<AiRunner<D>, "action">,
): AiRunner<D> {
  return { action, ...rest };
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
    const mod = moduleOf.get(d.id);
    const dot = d.id.indexOf(".");
    if (mod === undefined) {
      if (dot !== -1) {
        throw new ServerModuleError(
          `AI action "${d.id}" has a module prefix but no module registered it`,
        );
      }
    } else if (!d.id.startsWith(`${mod}.`)) {
      throw new ServerModuleError(
        `AI action "${d.id}" must be prefixed with its module id "${mod}."`,
      );
    }
    const applies = Array.isArray(d.appliesTo) ? d.appliesTo : [d.appliesTo];
    for (const t of applies) {
      if (t === "*" || t === "none") continue;
      if (mod === undefined || ownedTypes.get(t) !== mod) {
        throw new ServerModuleError(
          `AI action "${d.id}" applies to item type "${t}" that its module does not own`,
        );
      }
    }
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
