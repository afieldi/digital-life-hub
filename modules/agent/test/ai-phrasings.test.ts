import { collectModules, coreAiActions, keywordInterpreter } from "@dlh/core";
import { runInterpreterSuite } from "@dlh/core/testing";
import requestsManifest from "@dlh/module-requests";
import tasksManifest from "@dlh/module-tasks";
import { expect, test } from "vitest";
import { corePhrasings } from "../../../packages/core/test/ai-phrasings";
import { requestsPhrasings } from "../../requests/test/ai-phrasings";
import { tasksPhrasings } from "../../tasks/test/ai-phrasings";
import manifest from "../src/manifest";
import { agentPhrasings } from "./ai-phrasings";

const registry = collectModules([tasksManifest, requestsManifest, manifest]);
const agentActions = registry.aiActions.filter((a) =>
  a.id.startsWith("agent."),
);
const all = [...Object.values(coreAiActions), ...registry.aiActions];

async function score(phrasings: typeof agentPhrasings) {
  const { accuracy, misses } = await runInterpreterSuite(
    keywordInterpreter,
    all,
    phrasings,
  );
  const report = misses.map(
    (m) =>
      `${m.phrasing.actionId}/${m.phrasing.kind} → ${m.got.actionId}/${m.got.kind}: "${m.phrasing.text}"`,
  );
  return { ok: accuracy >= 0.9, report };
}

test("keywordInterpreter scores ≥ 0.9 on core + tasks + requests + agent phrasings", async () => {
  const r = await score([
    ...corePhrasings,
    ...tasksPhrasings,
    ...requestsPhrasings,
    ...agentPhrasings,
  ]);
  expect({ ok: r.ok, report: r.report }).toMatchObject({ ok: true });
});

test("Agent's own phrasings score ≥ 0.9 among all the actions", async () => {
  const r = await score(agentPhrasings);
  expect(r.report).toEqual([]);
});

test("Agent's actions don't lower the others' accuracy", async () => {
  const phrasings = [...corePhrasings, ...tasksPhrasings, ...requestsPhrasings];
  const withoutAgent = await runInterpreterSuite(
    keywordInterpreter,
    [
      ...Object.values(coreAiActions),
      ...registry.aiActions.filter((a) => !a.id.startsWith("agent.")),
    ],
    phrasings,
  );
  const together = await runInterpreterSuite(
    keywordInterpreter,
    all,
    phrasings,
  );
  const show = (m: { phrasing: { text: string }; got: { actionId: string } }) =>
    `${m.phrasing.text} → ${m.got.actionId}`;
  expect(together.misses.map(show)).toEqual(withoutAgent.misses.map(show));
});

test("at least 8 phrasings for each of the 6 Agent AI actions", () => {
  const ids = agentActions.map((a) => a.id).sort();
  expect(ids).toEqual(
    [
      "agent.assign",
      "agent.assignRequest",
      "agent.cancel",
      "agent.retry",
      "agent.runs",
      "agent.unassign",
    ].sort(),
  );
  for (const id of ids) {
    const n = agentPhrasings.filter((p) => p.actionId === id).length;
    expect({ id, enough: n >= 8 }).toEqual({ id, enough: true });
  }
});
