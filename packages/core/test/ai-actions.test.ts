import { describe, expect, it } from "vitest";
import {
  type AiActionDescription,
  capFor,
  collectModules,
  coreAiActions,
  defineModule,
  describeAiAction,
  kindAllowed,
} from "../src";

const valid: AiActionDescription = {
  id: "notes.tidy",
  label: "Tidy",
  description: "Tidies a note. Use when asked to tidy. Not for deleting.",
  appliesTo: ["note"],
  kinds: ["suggest", "do"],
  effects: ["updateItem"],
};

describe("capFor", () => {
  it("maps effects to the highest kind they allow", () => {
    expect(capFor([])).toBe("ask");
    expect(capFor(["updateItem"])).toBe("do");
    expect(capFor(["createItems", "addLinks"])).toBe("do");
    expect(capFor(["updateItem", "deleteItems"])).toBe("suggest");
    expect(capFor(["setArchived"])).toBe("suggest");
    expect(capFor(["writeOtherItems"])).toBe("suggest");
  });
});

describe("kindAllowed", () => {
  it("downgrades to the cap", () => {
    expect(kindAllowed(coreAiActions.delete, "do")).toBe("suggest");
  });
  it("moves up to the nearest allowed kind", () => {
    expect(kindAllowed(coreAiActions.retitle, "ask")).toBe("suggest");
  });
  it("keeps an allowed kind", () => {
    expect(kindAllowed(coreAiActions.retitle, "do")).toBe("do");
    expect(kindAllowed(coreAiActions.answer, "do")).toBe("ask");
  });
});

describe("describeAiAction", () => {
  it("returns a valid description", () => {
    expect(describeAiAction(valid)).toBe(valid);
  });
  it("rejects bad ids, empty kinds and empty descriptions", () => {
    expect(() => describeAiAction({ ...valid, id: "Bad Id" })).toThrow();
    expect(() => describeAiAction({ ...valid, kinds: [] })).toThrow();
    expect(() => describeAiAction({ ...valid, description: " " })).toThrow();
  });
  it("has valid core actions", () => {
    for (const a of Object.values(coreAiActions)) describeAiAction(a);
  });
});

describe("registry aiActions", () => {
  it("collects manifest aiActions", () => {
    const m = defineModule({
      id: "notes",
      routes: () => [],
      aiActions: [valid],
    });
    expect(collectModules([m]).aiActions).toEqual([valid]);
    expect(collectModules([]).aiActions).toEqual([]);
  });
});
