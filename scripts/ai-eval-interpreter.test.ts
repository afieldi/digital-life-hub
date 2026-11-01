import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { collectPhrasingFiles, formatMiss } from "./ai-eval-interpreter";

it("runs on the Core phrasings, exits 0 and prints Accuracy", () => {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/ai-eval-interpreter.ts", "--interpreter=keywords"],
    { encoding: "utf8" },
  );
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/Accuracy: \d+\.\d%/);
  expect(r.stdout).toMatch(/ms per guess/);
}, 60_000);

it("handles there being no module phrasing files", () => {
  expect(collectPhrasingFiles()).toEqual(expect.any(Array));
});

it("formats a miss as expected vs got", () => {
  expect(
    formatMiss({
      phrasing: {
        text: "rename this",
        itemType: "test",
        actionId: "retitle",
        kind: "do",
      },
      got: { actionId: "answer", kind: "ask" },
    }),
  ).toBe('expected retitle/do, got answer/ask: "rename this"');
});
