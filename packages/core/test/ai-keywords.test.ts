import { describe, expect, it } from "vitest";
import {
  applicableActions,
  coreAiActions,
  describeAiAction,
  keywordInterpreter,
  NOT_SURE_BELOW,
} from "../src";
import { runInterpreterSuite } from "../src/ai/suite";
import { corePhrasings } from "./ai-phrasings";

const core = Object.values(coreAiActions);

const ask = (text: string, itemType: string | null = "test", actions = core) =>
  keywordInterpreter.interpret({
    text,
    itemType,
    actions: applicableActions(actions, itemType),
    signal: new AbortController().signal,
  });

describe("applicableActions", () => {
  it("offers only 'none' actions when no item is on screen", () => {
    expect(applicableActions(core, null).map((a) => a.id)).toEqual(["answer"]);
  });

  it("lists type-specific actions before '*' ones and drops none-only", () => {
    const specific = describeAiAction({
      id: "tasks.retitle",
      label: "Rename task",
      description: "Renames a task. Use for tasks. Not for notes.",
      appliesTo: ["task"],
      kinds: ["suggest", "do"],
      effects: ["updateItem"],
    });
    const noneOnly = describeAiAction({
      id: "tasks.plan",
      label: "Plan",
      description: "Plans the day. Use with nothing open. Not for one item.",
      appliesTo: "none",
      kinds: ["ask"],
      effects: [],
    });
    const ids = applicableActions([...core, specific, noneOnly], "task").map(
      (a) => a.id,
    );
    expect(ids[0]).toBe("tasks.retitle");
    expect(ids).toContain("answer");
    expect(ids).not.toContain("tasks.plan");
    expect(applicableActions([specific], "note")).toEqual([]);
  });
});

describe("keyword interpreter", () => {
  it("meets the 90% bar on the Core phrasings", async () => {
    expect(corePhrasings.length).toBeGreaterThanOrEqual(30);
    const { accuracy, misses } = await runInterpreterSuite(
      keywordInterpreter,
      core,
      corePhrasings,
    );
    expect(
      misses.map(
        (m) => `${m.phrasing.text} -> ${m.got.actionId}/${m.got.kind}`,
      ),
    ).toEqual([]);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("is unsure about a negated request", async () => {
    const r = await ask("don't rename it");
    expect(r.actionId).toBe("retitle");
    expect(r.confidence).toBeLessThan(NOT_SURE_BELOW);
  });

  it("is confident about a plain command", async () => {
    const r = await ask("give this a better title");
    expect(r).toMatchObject({
      actionId: "retitle",
      kind: "do",
      source: "keywords",
    });
    expect(r.confidence).toBeGreaterThanOrEqual(NOT_SURE_BELOW);
  });

  it("never returns 'do' for delete", async () => {
    for (const text of [
      "delete this",
      "please delete this",
      "can you delete it?",
    ]) {
      expect((await ask(text)).kind).not.toBe("do");
    }
  });

  it("always answers when no item is on screen", async () => {
    for (const text of [
      "delete this",
      "rename it",
      "give this a better title",
    ]) {
      const r = await ask(text, null);
      expect(r).toMatchObject({ actionId: "answer", kind: "ask" });
    }
  });

  it("falls back to answer with low confidence when nothing matches", async () => {
    const r = await ask("hmm");
    expect(r).toMatchObject({
      actionId: "answer",
      kind: "ask",
      confidence: 0.3,
    });
  });

  it("prefers a type-specific action with the same words", async () => {
    const specific = describeAiAction({
      id: "tasks.retitle",
      label: "Rename task",
      description: "Renames a task. Use for tasks. Not for notes.",
      appliesTo: ["task"],
      kinds: ["suggest", "do"],
      effects: ["updateItem"],
      words: ["title", "rename", "name it"],
    });
    const actions = [...core, specific];
    expect((await ask("rename this", "task", actions)).actionId).toBe(
      "tasks.retitle",
    );
    expect((await ask("rename this", "note", actions)).actionId).toBe(
      "retitle",
    );
  });

  it("lists the runner-up as an alternative", async () => {
    const r = await ask("delete this and give it a title");
    expect(r.alternatives.length).toBeGreaterThan(0);
  });

  it("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      keywordInterpreter.interpret({
        text: "rename this",
        itemType: "test",
        actions: core,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });
});
