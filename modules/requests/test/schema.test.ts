import { expect, expectTypeOf, test } from "vitest";
import type { z } from "zod";
import {
  fileInput,
  type Outcome,
  outcome,
  resolveInput,
  type Source,
} from "../src/schema";

const taskId = "0b7e3f0e-7a55-4a3b-9c0e-2f7d4f6f1a11";
const id = "0b7e3f0e-7a55-4a3b-9c0e-2f7d4f6f1a12";
const base = { id, expectedUpdatedAt: "2026-11-02T12:00:00.000Z" };
const action = { label: "Approve", operation: "agent.approve", input: {} };

test("externalId with manual is refused", () => {
  expect(
    fileInput.safeParse({ title: "A", source: "manual", externalId: "x" })
      .success,
  ).toBe(false);
  expect(fileInput.safeParse({ title: "A", externalId: "x" }).success).toBe(
    true,
  );
  expect(
    fileInput.safeParse({ title: "A", source: "slack", externalId: "x" })
      .success,
  ).toBe(true);
});

test("four actions are refused", () => {
  const actions = (n: number) => Array.from({ length: n }, () => action);
  expect(fileInput.safeParse({ title: "A", actions: actions(3) }).success).toBe(
    true,
  );
  expect(fileInput.safeParse({ title: "A", actions: actions(4) }).success).toBe(
    false,
  );
});

test("outcome task needs a taskId", () => {
  expect(resolveInput.safeParse({ ...base, outcome: "task" }).success).toBe(
    false,
  );
  expect(
    resolveInput.safeParse({ ...base, outcome: "task", taskId }).success,
  ).toBe(true);
});

test("handled with a taskId is refused", () => {
  expect(
    resolveInput.safeParse({ ...base, outcome: "handled", taskId }).success,
  ).toBe(false);
  expect(resolveInput.safeParse({ ...base, outcome: "handled" }).success).toBe(
    true,
  );
});

test("refined inputs are still objects, for describeOperation", () => {
  expectTypeOf(fileInput).toExtend<z.ZodObject>();
  expectTypeOf(resolveInput).toExtend<z.ZodObject>();
  expect(Object.keys(fileInput.shape)).toContain("title");
  expect(outcome.options).toEqual(["task", "handled", "not_for_me"]);
  expectTypeOf<Source>().toEqualTypeOf<"manual" | "ai" | "slack" | "agent">();
  expectTypeOf<Outcome>().toEqualTypeOf<"task" | "handled" | "not_for_me">();
});
