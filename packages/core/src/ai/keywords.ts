import { type AiActionDescription, kindAllowed } from "./actions";
import {
  type Interpretation,
  isTypeSpecific,
  type RequestInterpreter,
} from "./interpreter";
import type { AiKind } from "./kinds";

const SOURCE = "keywords";
const NO_MATCH_CONFIDENCE = 0.3;
/** Confidence ceiling when the wording gives no clear kind. */
const UNCLEAR_KIND_CONFIDENCE = 0.5;
const TYPE_BONUS = 1;
const TYPO_FACTOR = 0.5;
const TYPO_MIN_LENGTH = 5;
const MAX_ALTERNATIVES = 3;

/** Question words say little about which action is meant, so they score less. */
const QUESTION_WORDS = new Set([
  "what",
  "why",
  "how",
  "who",
  "when",
  "where",
  "which",
]);
const QUESTION_WORD_SCORE = 0.5;
const QUESTION_STARTERS = new Set([
  ...QUESTION_WORDS,
  "is",
  "are",
  "was",
  "were",
  "does",
  "do",
  "did",
  "has",
  "have",
]);

const NEGATIONS = new Set([
  "don't",
  "dont",
  "do not",
  "never",
  "not",
  "doesn't",
  "won't",
]);
const ALTERNATIVE_PHRASES = [
  "suggest",
  "suggestions",
  "ideas",
  "idea",
  "options",
  "alternatives",
  "a few",
  "what would be a good",
  "what would be a better",
];
const ASK_WORDS = ["summarise", "summarize", "summary", "explain", "tell me"];
const LEADING_VERBS = new Set([
  "give",
  "make",
  "change",
  "set",
  "fix",
  "add",
  "create",
  "update",
  "write",
  "rewrite",
  "turn",
  "put",
  "move",
  "archive",
  "link",
  "name",
  "shorten",
  "edit",
  "tidy",
  "clean",
]);

/** Lower-cased words, with curly apostrophes folded and a possessive "'s" dropped. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((t) => t !== "");
}

/** A crude stem so "titles", "renamed" and "deleting" meet their base word. */
function stem(word: string): string {
  let w = word;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** True when the two words differ by one insertion, deletion, substitution or swap. */
function oneLetterApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

type Prepared = { raw: string[]; stems: string[] };

function prepare(text: string): Prepared {
  const raw = tokenize(text);
  return { raw, stems: raw.map(stem) };
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

/** The score one `words` entry adds: phrases n + 1, single words 1, typos half. */
function scoreEntry(entry: string, input: Prepared): number {
  const parts = prepare(entry);
  if (parts.stems.length === 0) return 0;
  if (parts.stems.length > 1) {
    return containsSequence(input.stems, parts.stems)
      ? parts.stems.length + 1
      : 0;
  }
  const word = parts.raw[0] as string;
  const base = QUESTION_WORDS.has(word) ? QUESTION_WORD_SCORE : 1;
  if (input.stems.includes(parts.stems[0] as string)) return base;
  if (
    word.length >= TYPO_MIN_LENGTH &&
    input.raw.some(
      (t) => t.length >= TYPO_MIN_LENGTH && oneLetterApart(t, word),
    )
  ) {
    return base * TYPO_FACTOR;
  }
  return 0;
}

function scoreAction(
  action: AiActionDescription,
  input: Prepared,
  itemType: string | null,
): number {
  const matched = (action.words ?? []).reduce(
    (sum, entry) => sum + scoreEntry(entry, input),
    0,
  );
  if (matched === 0) return 0;
  return matched + (isTypeSpecific(action, itemType) ? TYPE_BONUS : 0);
}

/** Whether a word reads as a command: a common imperative or the action's own word. */
function isCommandWord(
  word: string,
  action: AiActionDescription | null,
): boolean {
  if (LEADING_VERBS.has(word)) return true;
  const wordStem = stem(word);
  return (action?.words ?? []).some(
    (w) => prepare(w).stems[0] === wordStem && !QUESTION_WORDS.has(w),
  );
}

/**
 * "can you rename this", "please give...", "delete this please": a polite marker
 * next to a command word. "can you tell me what the title means" is a question.
 */
function politeCommand(
  input: Prepared,
  text: string,
  action: AiActionDescription,
): boolean {
  const { raw } = input;
  const modal = /^\s*(?:can|could|would|will) you\b/i.test(text);
  const pleaseAt = raw.indexOf("please");
  if (!modal && pleaseAt === -1) return false;
  const afterModal = raw.slice(2);
  const afterPlease = pleaseAt === 0 ? raw.slice(1) : afterModal;
  // A trailing "please" leaves the command at the start of the text.
  const next =
    modal && raw[0] !== "please"
      ? afterModal[0]
      : pleaseAt === raw.length - 1
        ? raw[0]
        : afterPlease[0];
  return next !== undefined && isCommandWord(next, action);
}

/** Step 3: the kind the wording asks for, or null when it is unclear. */
function wantedKind(
  input: Prepared,
  text: string,
  matchedAction: AiActionDescription | null,
): AiKind | null {
  const { raw } = input;
  const joined = ` ${raw.join(" ")} `;
  if (raw.some((t) => NEGATIONS.has(t))) return null;
  if (ALTERNATIVE_PHRASES.some((p) => joined.includes(` ${p} `)))
    return "suggest";
  if (matchedAction && politeCommand(input, text, matchedAction)) return "do";
  const first = raw[0];
  if (
    (first !== undefined && QUESTION_STARTERS.has(first)) ||
    text.trim().endsWith("?") ||
    ASK_WORDS.some((w) => joined.includes(` ${w} `))
  ) {
    return "ask";
  }
  if (first !== undefined && isCommandWord(first, matchedAction)) return "do";
  return null;
}

/** Step 4: the closest kind the action supports, under its cap. */
function reconcile(action: AiActionDescription, kind: AiKind | null): AiKind {
  const wanted =
    kind ??
    (action.kinds.includes("suggest")
      ? "suggest"
      : (action.kinds[0] as AiKind));
  return kindAllowed(action, wanted);
}

export const keywordInterpreter: RequestInterpreter = {
  id: SOURCE,
  async interpret({
    text,
    itemType,
    actions,
    signal,
  }): Promise<Interpretation> {
    signal.throwIfAborted();
    const input = prepare(text);

    const scored = actions
      .map((action) => ({
        action,
        score: scoreAction(action, input, itemType),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const winner = scored[0];
    if (!winner) {
      const fallback = actions.find((a) => a.id === "answer") ?? actions[0];
      if (!fallback) throw new Error("No AI action applies here");
      return {
        actionId: fallback.id,
        kind: reconcile(fallback, wantedKind(input, text, null)),
        confidence: NO_MATCH_CONFIDENCE,
        alternatives: [],
        matched: false,
        source: SOURCE,
      };
    }

    const kind = wantedKind(input, text, winner.action);
    const runnersUp = scored.slice(1, 1 + MAX_ALTERNATIVES);
    const runnerUp = runnersUp[0];
    let confidence = runnerUp
      ? winner.score / (winner.score + runnerUp.score)
      : 1;
    if (kind === null)
      confidence = Math.min(confidence, UNCLEAR_KIND_CONFIDENCE);

    return {
      actionId: winner.action.id,
      kind: reconcile(winner.action, kind),
      confidence,
      alternatives: runnersUp.map((r) => ({
        actionId: r.action.id,
        kind: reconcile(r.action, kind),
      })),
      matched: true,
      source: SOURCE,
    };
  },
};
