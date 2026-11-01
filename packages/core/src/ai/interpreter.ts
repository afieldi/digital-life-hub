import type { AiActionDescription } from "./actions";
import type { AiKind } from "./kinds";

export type Interpretation = {
  actionId: string;
  kind: AiKind;
  /** 0 to 1; below `NOT_SURE_BELOW` the row shows "Not sure". */
  confidence: number;
  alternatives: { actionId: string; kind: AiKind }[];
  /**
   * False when nothing in the text pointed at an action and `actionId` is only
   * the fallback; the command bar then does not offer AI.
   */
  matched: boolean;
  /** The interpreter's id, recorded in the log. */
  source: string;
};

export interface RequestInterpreter {
  /** "keywords"; later e.g. "model:haiku". */
  id: string;
  interpret(input: {
    text: string;
    itemType: string | null;
    /** Already narrowed to what applies here (see `applicableActions`). */
    actions: AiActionDescription[];
    signal: AbortSignal;
  }): Promise<Interpretation>;
}

/** Below this confidence the command bar shows "Not sure". */
export const NOT_SURE_BELOW = 0.6;

function scopes(a: AiActionDescription): string[] {
  return Array.isArray(a.appliesTo) ? a.appliesTo : [a.appliesTo];
}

/** Whether the action names this item type itself, rather than `"*"`. */
export function isTypeSpecific(
  a: AiActionDescription,
  itemType: string | null,
): boolean {
  return (
    itemType !== null &&
    scopes(a).some((s) => s === itemType && s !== "*" && s !== "none")
  );
}

/**
 * The actions that can run for what is on screen. With no item, only `"none"`
 * actions; with an item, type-specific actions first, then `"*"` ones.
 */
export function applicableActions(
  all: AiActionDescription[],
  itemType: string | null,
): AiActionDescription[] {
  if (itemType === null) return all.filter((a) => scopes(a).includes("none"));
  const specific = all.filter((a) => isTypeSpecific(a, itemType));
  const open = all.filter(
    (a) => !isTypeSpecific(a, itemType) && scopes(a).includes("*"),
  );
  return [...specific, ...open];
}
