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
  /**
   * The action's name as ⌘K matched it, lowercased: its label or one of its
   * `words` ("not for me"), which `text` no longer holds.
   */
  name?: string;
  now: Date;
  /** The device's IANA zone. */
  timeZone: string;
};

/**
 * Thrown by a palette builder (a palette function, `toInput`, `load`) when the
 * context can't build the input yet, e.g. no item on screen. ⌘K shows the row
 * as waiting; any other error is a bug and is logged.
 */
export class NotReady extends Error {
  override name = "NotReady";
}

/** The versioned keys of the item on screen; `NotReady` when there is none. */
export function itemOnScreen(ctx: PaletteContext): {
  id: string;
  expectedUpdatedAt: string;
} {
  if (!ctx.item) throw new NotReady("No item on screen");
  return { id: ctx.item.id, expectedUpdatedAt: ctx.item.updatedAt };
}

/** Runs one of the registry's query operations by id, as ⌘K would call it. */
export type PaletteRead = (
  operationId: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

/**
 * ⌘K's form for an operation whose input is built from other params:
 * `prefill` reads what it can from the context, a form generated from
 * `params` asks for the rest, and `toInput` turns them into the input.
 */
export type PaletteForm<I, P extends z.ZodObject = z.ZodObject> = {
  params: P;
  prefill?: (ctx: PaletteContext) => Record<string, unknown>;
  /**
   * Reads what the context doesn't hold, such as the item on screen's current
   * values or parents, through a query. Its values fill `params` under
   * `prefill`'s; ⌘K waits for it before it plans the row. Runs only with an
   * item on screen.
   */
  load?: (
    ctx: PaletteContext,
    read: PaletteRead,
  ) => Promise<Record<string, unknown>>;
  /** Always open the form, even when `params` are filled (e.g. editing the item's values). */
  review?: boolean;
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
  /**
   * What the scripted dev and e2e fake answers as AI with (the input without
   * the item keys), when guessing from field names would break a rule the
   * schema can't show, e.g. a field that must go with another.
   */
  devFake?: Record<string, unknown>;
  /**
   * Operations of other modules this mutation's `run` may call with `w.call`.
   * They must be registered, not this operation, and make no calls of their own.
   */
  calls?: OperationDescription[];
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
  if (d.kind === "query" && d.calls?.length) {
    throw new OperationError(`Operation "${d.id}" is a query with calls`);
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
