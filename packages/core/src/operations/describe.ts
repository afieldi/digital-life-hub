import type { z } from "zod";
import { ACTION_ID, type AiActionDescription } from "../ai/actions";
import type { AiEffect } from "../ai/kinds";
import { formFields, OperationError } from "./fields";

/** What ⌘K knows when building an operation's input. */
export type PaletteContext = {
  /** The item on screen, if any. */
  item?: { id: string; type: string; updatedAt: string };
  /** What was typed after the action's name. */
  text: string;
  now: Date;
  /** The device's IANA zone. */
  timeZone: string;
};

/**
 * ⌘K's form for an operation whose input is built from other params:
 * `prefill` reads what it can from the context, a form generated from
 * `params` asks for the rest, and `toInput` turns them into the input.
 */
export type PaletteForm<I, P extends z.ZodObject = z.ZodObject> = {
  params: P;
  prefill?: (ctx: PaletteContext) => Record<string, unknown>;
  // Method syntax on purpose: a form with specific params must still be
  // assignable to `PaletteForm<I>` (any params) in `ModuleManifest.operations`.
  toInput(ctx: PaletteContext, params: z.infer<P>): I;
};

/**
 * How an operation appears in ⌘K: `false` hides it; `true` (the default) is a
 * form generated from the input, with `id` and `expectedUpdatedAt` from the
 * item on screen; a function builds the input from the context (`null` is not
 * ready yet); an object is a `PaletteForm`.
 */
export type PaletteSpec<I, P extends z.ZodObject = z.ZodObject> =
  | boolean
  | ((ctx: PaletteContext) => I | null)
  | PaletteForm<I, P>;

/**
 * One thing a module can do or read: its tRPC endpoint, ⌘K action and AI
 * action. `subject` and `summary` use method syntax so a description with a
 * specific input is assignable to `OperationDescription` (any input).
 */
export type OperationDescription<
  S extends z.ZodObject = z.ZodObject,
  P extends z.ZodObject = z.ZodObject,
> = {
  /** Module-prefixed, as AI action ids (`tasks.reschedule`). */
  id: string;
  kind: "query" | "mutation";
  label: string;
  description: string;
  appliesTo: AiActionDescription["appliesTo"];
  words?: string[];
  group?: "create" | "actions";
  input: S;
  /** The item this acts on; `null` for none. */
  subject(input: z.infer<S>): string | null;
  effects: AiEffect[];
  summary(input: z.infer<S>): string;
  /** Defaults to `true`. */
  palette?: PaletteSpec<z.infer<S>, P>;
  /** Defaults to `true`. */
  ai?: boolean;
};

/** Input keys ⌘K fills from the item on screen rather than a form. */
export const ITEM_KEYS = ["id", "expectedUpdatedAt"] as const;

export function describeOperation<
  S extends z.ZodObject,
  P extends z.ZodObject = z.ZodObject,
>(d: OperationDescription<S, P>): OperationDescription<S, P> {
  if (!ACTION_ID.test(d.id)) {
    throw new OperationError(`Invalid operation id "${d.id}"`);
  }
  if (d.kind === "query" && d.effects.length > 0) {
    throw new OperationError(`Operation "${d.id}" is a query with effects`);
  }
  try {
    if (d.palette === undefined || d.palette === true) {
      formFields(d.input, [...ITEM_KEYS]);
    } else if (typeof d.palette === "object") {
      formFields(d.palette.params);
    }
  } catch (e) {
    if (e instanceof OperationError) {
      throw new OperationError(`Operation "${d.id}": ${e.message}`);
    }
    throw e;
  }
  return d;
}
