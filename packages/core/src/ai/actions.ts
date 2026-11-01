import { AI_KIND_ORDER, type AiEffect, type AiKind, capFor } from "./kinds";

export type AiActionDescription = {
  id: string;
  label: string;
  description: string;
  appliesTo: string[] | "*" | "none" | ("*" | "none")[];
  kinds: AiKind[];
  effects: AiEffect[];
  words?: string[];
};

const ACTION_ID = /^([a-z][a-z0-9]*\.)?[a-z][a-zA-Z0-9]*$/;

export function describeAiAction(d: AiActionDescription): AiActionDescription {
  if (!ACTION_ID.test(d.id)) {
    throw new Error(`Invalid AI action id "${d.id}"`);
  }
  if (d.kinds.length === 0) {
    throw new Error(`AI action "${d.id}" must allow at least one kind`);
  }
  if (d.description.trim() === "") {
    throw new Error(`AI action "${d.id}" needs a description`);
  }
  return d;
}

/**
 * The kind this action will actually run as when `kind` is requested: the
 * closest of its own kinds that does not exceed what its effects permit. Ties
 * go to the less autonomous kind, so a request for "do" downgrades to "suggest".
 */
export function kindAllowed(d: AiActionDescription, kind: AiKind): AiKind {
  const rank = (k: AiKind) => AI_KIND_ORDER.indexOf(k);
  const cap = rank(capFor(d.effects));
  const wanted = rank(kind);
  const candidates = d.kinds.filter((k) => rank(k) <= cap);
  if (candidates.length === 0) return AI_KIND_ORDER[cap] as AiKind;
  return candidates.reduce((best, k) => {
    const dk = Math.abs(rank(k) - wanted);
    const db = Math.abs(rank(best) - wanted);
    return dk < db || (dk === db && rank(k) < rank(best)) ? k : best;
  });
}

export const coreAiActions = {
  answer: describeAiAction({
    id: "answer",
    label: "Answer",
    description:
      "Answers a question or explains something using the item and its links as context. Use when the person asks what, why or how, or wants a summary. Not for changing anything.",
    appliesTo: ["*", "none"],
    kinds: ["ask"],
    effects: [],
    words: ["summarise", "summarize", "explain", "what", "why", "how"],
  }),
  retitle: describeAiAction({
    id: "retitle",
    label: "Rename",
    description:
      "Rewrites the item's title to be clearer and more specific. Use when the person wants a new or better name. Not for editing the item's content.",
    appliesTo: "*",
    kinds: ["suggest", "do"],
    effects: ["updateItem"],
    words: ["title", "rename", "name it"],
  }),
  delete: describeAiAction({
    id: "delete",
    label: "Delete",
    description:
      "Deletes the item. Use when the person wants it gone. Not for archiving or for removing only part of its content.",
    appliesTo: "*",
    kinds: ["suggest"],
    effects: ["deleteItems"],
    words: ["delete", "remove", "get rid of", "trash"],
  }),
};
