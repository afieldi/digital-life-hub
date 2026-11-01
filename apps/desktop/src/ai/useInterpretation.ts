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
 * previous guess. `interpretation` is null for empty text or when no action
 * applies (`actions` null means not known yet). Until the guess for the
 * current text arrives, the previous one is kept on screen with `current`
 * false, so nothing runs the new text with the old guess.
 */
export function useInterpretation(
  text: string,
  itemType: string | null,
  actions: AiActionDescription[] | null,
): { interpretation: Interpretation | null; current: boolean } {
  // Tagged with its text, so a guess for older text is never used for newer.
  const [result, setResult] = useState<{
    text: string;
    interpretation: Interpretation;
  } | null>(null);
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
          if (!ctrl.signal.aborted) setResult({ text, interpretation: i });
        })
        .catch(() => {});
    }, INTERPRET_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [empty, text, itemType, actions]);

  if (empty) return { interpretation: null, current: true };
  if (!result) return { interpretation: null, current: false };
  return {
    interpretation: result.interpretation,
    current: result.text === text,
  };
}
