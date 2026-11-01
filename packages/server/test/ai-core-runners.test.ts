import { coreAiRunners } from "../src";
import type { AiContext } from "../src/ai/context";

const runner = (id: string) => {
  const r = coreAiRunners.find((x) => x.action.id === id);
  if (!r) throw new Error(`no runner ${id}`);
  return r;
};
const ok = (id: string, kind: "ask" | "suggest" | "do", v: unknown) =>
  runner(id).output[kind]?.safeParse(v).success;

const ctx = {
  item: { id: "i", title: "Old" },
  text: "",
  version: "v",
} as unknown as AiContext;
const uuid = "0b9a3d5e-7d6f-4a63-8a53-0a1c2d3e4f50";
const opt = (title: string, reason = "Because.") => ({ title, reason });

test("every core action has a runner with the kinds it declares", () => {
  expect(coreAiRunners.map((r) => r.action.id).sort()).toEqual([
    "answer",
    "delete",
    "retitle",
  ]);
  for (const r of coreAiRunners) {
    expect(Object.keys(r.output).sort()).toEqual([...r.action.kinds].sort());
    expect(r.system).toMatch(/personal tasks-and-notes app/);
    expect(r.system).toMatch(/JSON/);
  }
});

test("answer output", () => {
  expect(ok("answer", "ask", { answer: "Hi", used: [uuid] })).toBe(true);
  expect(ok("answer", "ask", { answer: "Hi", used: [] })).toBe(true);
  expect(ok("answer", "ask", { answer: "x".repeat(4001), used: [] })).toBe(
    false,
  );
  expect(ok("answer", "ask", { answer: "Hi", used: ["nope"] })).toBe(false);
  expect(
    ok("answer", "ask", { answer: "Hi", used: Array(11).fill(uuid) }),
  ).toBe(false);
  expect(ok("answer", "ask", { foo: 1 })).toBe(false);
  expect(runner("answer").apply).toBeUndefined();
});

test("retitle suggest output", () => {
  const three = [opt("A"), opt("B"), opt("C")];
  expect(ok("retitle", "suggest", { options: three })).toBe(true);
  expect(ok("retitle", "suggest", { options: three.slice(0, 2) })).toBe(false);
  expect(
    ok("retitle", "suggest", {
      options: [opt("A"), opt("B"), opt("C", "x".repeat(201))],
    }),
  ).toBe(false);
  expect(
    ok("retitle", "suggest", { options: [opt("A"), opt("B"), opt("")] }),
  ).toBe(false);
  expect(ok("retitle", "suggest", { extra: 1 })).toBe(false);
});

test("retitle do output and summary", () => {
  expect(ok("retitle", "do", { title: "New" })).toBe(true);
  expect(ok("retitle", "do", { title: "" })).toBe(false);
  expect(ok("retitle", "do", { title: "New", extra: 1 })).toBe(false);
  expect(runner("retitle").summary?.({ title: "New" }, ctx)).toBe(
    "Renamed to “New”",
  );
});

test("delete suggest output and summary", () => {
  expect(ok("delete", "suggest", { options: [{ summary: "Delete it" }] })).toBe(
    true,
  );
  expect(ok("delete", "suggest", { options: [] })).toBe(false);
  expect(
    ok("delete", "suggest", { options: [{ summary: "a" }, { summary: "b" }] }),
  ).toBe(false);
  expect(
    ok("delete", "suggest", { options: [{ summary: "x".repeat(201) }] }),
  ).toBe(false);
  expect(ok("delete", "suggest", { foo: 1 })).toBe(false);
  expect(runner("delete").summary?.({}, ctx)).toBe("Deleted “Old”");
});
