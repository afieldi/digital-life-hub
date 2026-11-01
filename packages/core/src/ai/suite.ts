import type { AiActionDescription } from "./actions";
import {
  applicableActions,
  type Interpretation,
  type RequestInterpreter,
} from "./interpreter";
import type { AiKind } from "./kinds";

export type Phrasing = {
  text: string;
  /** The item on screen; null for none. */
  itemType: string | null;
  actionId: string;
  kind: AiKind;
};

/** Runs an interpreter over labelled phrasings and reports how many it got right. */
export async function runInterpreterSuite(
  interpreter: RequestInterpreter,
  actions: AiActionDescription[],
  phrasings: Phrasing[],
): Promise<{
  accuracy: number;
  misses: { phrasing: Phrasing; got: Interpretation }[];
}> {
  const misses: { phrasing: Phrasing; got: Interpretation }[] = [];
  for (const phrasing of phrasings) {
    const got = await interpreter.interpret({
      text: phrasing.text,
      itemType: phrasing.itemType,
      actions: applicableActions(actions, phrasing.itemType),
      signal: new AbortController().signal,
    });
    if (got.actionId !== phrasing.actionId || got.kind !== phrasing.kind) {
      misses.push({ phrasing, got });
    }
  }
  const accuracy =
    phrasings.length === 0
      ? 1
      : (phrasings.length - misses.length) / phrasings.length;
  return { accuracy, misses };
}
