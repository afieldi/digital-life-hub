import {
  type AiActionDescription,
  type Interpretation,
  keywordInterpreter,
} from "@dlh/core";
import { useEffect, useState } from "react";

/** Keyword guesses are instant; this only skips work between quick keystrokes. */
const INTERPRET_DEBOUNCE_MS = 30;

/**
 * How `text` is understood, live as it is typed. Each keystroke cancels the
 * previous guess. Null for empty text or when no action applies (`actions`
 * null means not known yet).
 */
export function useInterpretation(
  text: string,
  itemType: string | null,
  actions: AiActionDescription[] | null,
): Interpretation | null {
  const [result, setResult] = useState<Interpretation | null>(null);
  const empty = text.trim() === "" || !actions || actions.length === 0;

  useEffect(() => {
    if (empty || !actions) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      keywordInterpreter
        .interpret({ text, itemType, actions, signal: ctrl.signal })
        .then((i) => {
          if (!ctrl.signal.aborted) setResult(i);
        })
        .catch(() => {});
    }, INTERPRET_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [empty, text, itemType, actions]);

  return empty ? null : result;
}
