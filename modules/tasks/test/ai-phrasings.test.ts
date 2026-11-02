import { collectModules, coreAiActions, keywordInterpreter } from "@dlh/core";
import { runInterpreterSuite } from "@dlh/core/testing";
import { expect, test } from "vitest";
import { corePhrasings } from "../../../packages/core/test/ai-phrasings";
import manifest from "../src/manifest";
import tasksServer from "../src/server";
import { tasksPhrasings } from "./ai-phrasings";

const registry = collectModules([manifest]);
const tasksActions = registry.aiActions.filter((a) =>
  a.id.startsWith("tasks."),
);

test("keywordInterpreter scores ≥ 0.9 on core + tasks phrasings", async () => {
  const { accuracy, misses } = await runInterpreterSuite(
    keywordInterpreter,
    [...Object.values(coreAiActions), ...tasksActions],
    [...corePhrasings, ...tasksPhrasings],
  );
  const report = misses.map(
    (m) =>
      `${m.phrasing.actionId}/${m.phrasing.kind} → ${m.got.actionId}/${m.got.kind}: "${m.phrasing.text}"`,
  );
  expect({ accuracy: accuracy >= 0.9, report }).toMatchObject({
    accuracy: true,
  });
});

test("at least 8 phrasings for each of the 12 Tasks AI actions", () => {
  const ids = tasksActions.map((a) => a.id).sort();
  expect(ids).toEqual(
    [
      "tasks.addParent",
      "tasks.breakDown",
      "tasks.complete",
      "tasks.create",
      "tasks.due",
      "tasks.planToday",
      "tasks.removeParent",
      "tasks.reopen",
      "tasks.reorder",
      "tasks.reschedule",
      "tasks.rewriteNotes",
      "tasks.update",
    ].sort(),
  );
  for (const id of ids) {
    const n = tasksPhrasings.filter((p) => p.actionId === id).length;
    expect({ id, enough: n >= 8 }).toEqual({ id, enough: true });
  }
});

test("the manifest and the server list the same hand-written AI actions", () => {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
  expect(ids(manifest.aiActions ?? [])).toEqual(
    ids(tasksServer.aiActions ?? []),
  );
  expect(ids((tasksServer.aiRunners ?? []).map((r) => r.action))).toEqual(
    ids(tasksServer.aiActions ?? []),
  );
  expect(ids(tasksServer.aiActions ?? [])).toEqual([
    "tasks.breakDown",
    "tasks.planToday",
    "tasks.rewriteNotes",
  ]);
});
