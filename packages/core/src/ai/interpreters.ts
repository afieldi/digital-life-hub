import { z } from "zod";
import type { RequestInterpreter } from "./interpreter";
import { keywordInterpreter } from "./keywords";

/**
 * Every request interpreter the app can run, by the id Settings stores, with
 * its name there. A new interpreter (a model-based one) is one more entry.
 */
export const interpreters = {
  keywords: { label: "Keywords", interpreter: keywordInterpreter },
} satisfies Record<string, { label: string; interpreter: RequestInterpreter }>;

export type InterpreterId = keyof typeof interpreters;

/** An interpreter's id, as Settings stores it. */
export const interpreterId = z.enum(
  Object.keys(interpreters) as [InterpreterId, ...InterpreterId[]],
);

/** The interpreter `id` names; keywords for an id this app doesn't know. */
export function interpreterFor(id: string | undefined): RequestInterpreter {
  const known = interpreterId.safeParse(id);
  return interpreters[known.success ? known.data : "keywords"].interpreter;
}
