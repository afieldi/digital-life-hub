import type { askerInput } from "@dlh/core";
import { expect } from "vitest";
import type { z } from "zod";

type Asker = z.infer<typeof askerInput>;

const A: Asker = { slackUserId: "U_ASKER_A", githubLogin: "asker-a" };
const B: Asker = { slackUserId: "U_ASKER_B", githubLogin: "asker-b" };

/** Nothing: null, undefined, or an array or object whose every entry is nothing. */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.every(isEmpty);
  if (typeof v === "object") return Object.values(v).every(isEmpty);
  return false;
}

/** Calls an asker operation as A, whose data `seed` creates, and as unrelated B: A must see it, B nothing. */
export async function expectAskerScoped(
  call: (opId: string, input: unknown) => Promise<unknown>,
  opId: string,
  input: Record<string, unknown>,
  seed: (asker: Asker) => Promise<unknown>,
): Promise<void> {
  await seed(A);
  // A must see something, or B seeing nothing proves nothing.
  expect(isEmpty(await call(opId, { ...input, asker: A }))).toBe(false);
  expect(isEmpty(await call(opId, { ...input, asker: B }))).toBe(true);
}
