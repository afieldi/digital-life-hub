import {
  type AiActionDescription,
  collectModules,
  coreAiActions,
  keywordInterpreter,
} from "@dlh/core";
import { type Phrasing, runInterpreterSuite } from "@dlh/core/testing";
import tasksManifest from "@dlh/module-tasks";
import { expect, test } from "vitest";
import { corePhrasings } from "../../../packages/core/test/ai-phrasings";
import { tasksPhrasings } from "../../tasks/test/ai-phrasings";
import manifest from "../src/manifest";
import { requestsPhrasings } from "./ai-phrasings";

const registry = collectModules([tasksManifest, manifest]);
const ofModule = (prefix: string) =>
  registry.aiActions.filter((a) => a.id.startsWith(prefix));
const tasksActions = ofModule("tasks.");
const requestsActions = ofModule("requests.");
const all = [
  ...Object.values(coreAiActions),
  ...tasksActions,
  ...requestsActions,
];

async function score(actions: AiActionDescription[], phrasings: Phrasing[]) {
  const { accuracy, misses } = await runInterpreterSuite(
    keywordInterpreter,
    actions,
    phrasings,
  );
  const report = misses.map(
    (m) =>
      `${m.phrasing.actionId}/${m.phrasing.kind} → ${m.got.actionId}/${m.got.kind}: "${m.phrasing.text}"`,
  );
  return { accuracy, report };
}

test("keywordInterpreter scores ≥ 0.9 on core + tasks + requests phrasings", async () => {
  const { accuracy, report } = await score(all, [
    ...corePhrasings,
    ...tasksPhrasings,
    ...requestsPhrasings,
  ]);
  expect({ accuracy: accuracy >= 0.9, report }).toMatchObject({
    accuracy: true,
  });
});

test("Queue's own phrasings score ≥ 0.9 among all the actions", async () => {
  // So core's and Tasks' many phrasings can't hide Queue's misses.
  const { accuracy, report } = await score(all, requestsPhrasings);
  expect({ accuracy: accuracy >= 0.9, report }).toMatchObject({
    accuracy: true,
  });
});

test("Queue's actions don't lower Tasks' accuracy", async () => {
  const phrasings = [...corePhrasings, ...tasksPhrasings];
  const alone = await score(
    [...Object.values(coreAiActions), ...tasksActions],
    phrasings,
  );
  const together = await score(all, phrasings);
  expect(together.report).toEqual(alone.report);
});

// An AI action so agent runs get it as a hub tool; you don't ask for it
// (it takes a Slack asker), so it needs no phrasings.
const RUNS_ONLY = ["requests.fromSender"];

test("at least 8 phrasings for each of the 4 Queue AI actions you ask for", () => {
  const ids = requestsActions.map((a) => a.id).sort();
  expect(ids).toEqual(
    [
      "requests.file",
      "requests.fromSender",
      "requests.makeTask",
      "requests.open",
      "requests.resolve",
    ].sort(),
  );
  for (const id of ids.filter((i) => !RUNS_ONLY.includes(i))) {
    const n = requestsPhrasings.filter((p) => p.actionId === id).length;
    expect({ id, enough: n >= 8 }).toEqual({ id, enough: true });
  }
});

test("the phrasings include the spec's own, on a request where one is on screen", () => {
  const has = (text: string, actionId: string, itemType: string | null) =>
    requestsPhrasings.some(
      (p) =>
        p.text === text && p.actionId === actionId && p.itemType === itemType,
    );
  expect(has("file this", "requests.file", null)).toBe(true);
  expect(has("remind me to look at the contract", "requests.file", null)).toBe(
    true,
  );
  expect(has("what's waiting on me?", "requests.open", null)).toBe(true);
  expect(has("make a task from this", "requests.makeTask", "request")).toBe(
    true,
  );
  for (const text of [
    "handled",
    "done with this",
    "not for me",
    "ignore this",
  ]) {
    expect({ text, has: has(text, "requests.resolve", "request") }).toEqual({
      text,
      has: true,
    });
  }
});
