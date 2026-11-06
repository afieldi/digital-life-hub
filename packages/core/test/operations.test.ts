import { z } from "zod";
import {
  accessOf,
  capFor,
  collectModules,
  defineModule,
  describeOperation,
  dueFromLocal,
  dueValue,
  fields,
  formFields,
  ITEM_KEYS,
  itemOnScreen,
  localDueValue,
  ModuleRegistryError,
  NotReady,
  type OperationDescription,
  OperationError,
  operationList,
  toAiAction,
} from "../src";

describe("dueValue", () => {
  test("accepts a day", () =>
    expect(dueValue.safeParse({ date: "2026-11-06" }).success).toBe(true));
  test("accepts a moment with its zone", () =>
    expect(
      dueValue.safeParse({
        dateTime: "2026-11-06T09:00:00-08:00",
        timeZone: "America/Los_Angeles",
      }).success,
    ).toBe(true));
  test("accepts a moment without a zone", () =>
    expect(
      dueValue.safeParse({ dateTime: "2026-11-06T17:00:00Z" }).success,
    ).toBe(true));
  test("rejects both keys together", () =>
    expect(
      dueValue.safeParse({
        date: "2026-11-06",
        dateTime: "2026-11-06T09:00:00-08:00",
      }).success,
    ).toBe(false));
  test("rejects a date-time without an offset", () =>
    expect(
      dueValue.safeParse({ dateTime: "2026-11-06T09:00:00" }).success,
    ).toBe(false));
});

describe("formFields", () => {
  test("maps each supported schema to its field kind", () => {
    const schema = z.object({
      title: z.string().describe("Title"),
      priority: z.enum(["medium", "high"]).describe("Priority"),
      done: z.boolean(),
      due: fields.due().optional().describe("Due"),
      parentId: fields.item(["task"]).optional(),
      notes: fields.longText().describe("Notes").optional(),
      ref: z.uuid(),
    });
    expect(formFields(schema)).toEqual([
      {
        name: "title",
        label: "Title",
        kind: "text",
        optional: false,
        nullable: false,
      },
      {
        name: "priority",
        label: "Priority",
        kind: "choice",
        optional: false,
        nullable: false,
        options: ["medium", "high"],
      },
      {
        name: "done",
        label: "done",
        kind: "switch",
        optional: false,
        nullable: false,
      },
      {
        name: "due",
        label: "Due",
        kind: "due",
        optional: true,
        nullable: false,
      },
      {
        name: "parentId",
        label: "parentId",
        kind: "item",
        optional: true,
        nullable: false,
        types: ["task"],
      },
      {
        name: "notes",
        label: "Notes",
        kind: "longText",
        optional: true,
        nullable: false,
      },
      {
        name: "ref",
        label: "ref",
        kind: "text",
        optional: false,
        nullable: false,
      },
    ]);
  });
  test("nullable fields are optional and nullable, in either order", () => {
    const schema = z.object({
      a: fields.due().nullable().optional().describe("Due"),
      b: fields.due().optional().nullable(),
      c: fields.due().nullish(),
      d: z.enum(["medium", "high"]).default("medium"),
    });
    const due = { kind: "due", optional: true, nullable: true };
    expect(formFields(schema)).toEqual([
      { name: "a", label: "Due", ...due },
      { name: "b", label: "b", ...due },
      { name: "c", label: "c", ...due },
      {
        name: "d",
        label: "d",
        kind: "choice",
        optional: true,
        nullable: false,
        options: ["medium", "high"],
      },
    ]);
  });
  test("a label set on an inner layer is kept", () =>
    expect(
      formFields(
        z.object({ due: fields.due().describe("Due").nullable().optional() }),
      )[0]?.label,
    ).toBe("Due"));
  test("omits the given keys", () =>
    expect(
      formFields(
        z.object({
          id: z.uuid(),
          expectedUpdatedAt: z.string(),
          due: fields.due(),
        }),
        [...ITEM_KEYS],
      ).map((f) => f.name),
    ).toEqual(["due"]));
  test("fields.item validates as an item id", () => {
    expect(fields.item(["task"]).safeParse("nope").success).toBe(false);
    expect(
      fields.item(["task"]).safeParse("6f1c1f9e-3a4b-4c5d-8e9f-0a1b2c3d4e5f")
        .success,
    ).toBe(true);
  });
  test("fields.due validates as a Due", () =>
    expect(fields.due().safeParse({ date: "2026-11-06" }).success).toBe(true));
  test("an unsupported schema throws naming the field", () => {
    const schema = z.object({ count: z.number() });
    expect(() => formFields(schema)).toThrow(OperationError);
    expect(() => formFields(schema)).toThrow(/count/);
  });
});

const input = z.object({ id: z.uuid(), expectedUpdatedAt: z.string() });

describe("describeOperation", () => {
  test("returns the description", () => {
    const d = describeOperation({
      id: "tasks.complete",
      kind: "mutation",
      label: "Complete",
      description: "Marks the task on screen done.",
      appliesTo: ["task"],
      input,
      subject: (i) => i.id,
      effects: ["updateItem"],
      summary: () => "Complete",
    });
    expect(d.id).toBe("tasks.complete");
  });
  test("an invalid id throws", () =>
    expect(() =>
      describeOperation({
        id: "Tasks.complete",
        kind: "mutation",
        label: "Complete",
        description: "x",
        appliesTo: ["task"],
        input,
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: () => "Complete",
      }),
    ).toThrow(OperationError));
  test("a query with effects throws", () =>
    expect(() =>
      describeOperation({
        id: "tasks.peek",
        kind: "query",
        label: "Peek",
        description: "x",
        appliesTo: ["task"],
        input,
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: () => "Peek",
      }),
    ).toThrow(/query/));
  test("a query with calls is refused", () =>
    expect(() =>
      describeOperation({
        id: "tasks.peek",
        kind: "query",
        label: "Peek",
        description: "x",
        appliesTo: ["task"],
        input,
        subject: (i) => i.id,
        effects: [],
        summary: () => "Peek",
        calls: [
          describeOperation({
            id: "tasks.look",
            kind: "query",
            label: "Look",
            description: "x",
            appliesTo: ["task"],
            input,
            subject: (i) => i.id,
            effects: [],
            summary: () => "Look",
          }),
        ],
      }),
    ).toThrow('Operation "tasks.peek" is a query with calls'));
  test("palette true over an unsupported input field throws", () =>
    expect(() =>
      describeOperation({
        id: "tasks.weigh",
        kind: "mutation",
        label: "Weigh",
        description: "x",
        appliesTo: ["task"],
        input: input.extend({ weight: z.number() }),
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: () => "Weigh",
        palette: true,
      }),
    ).toThrow(/weight/));
  test("an omitted palette is checked like true", () =>
    expect(() =>
      describeOperation({
        id: "tasks.weigh",
        kind: "mutation",
        label: "Weigh",
        description: "x",
        appliesTo: ["task"],
        input: input.extend({ weight: z.number() }),
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: () => "Weigh",
      }),
    ).toThrow(OperationError));
  test("palette false skips the form check", () =>
    expect(() =>
      describeOperation({
        id: "tasks.weigh",
        kind: "mutation",
        label: "Weigh",
        description: "x",
        appliesTo: ["task"],
        input: input.extend({ weight: z.number() }),
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: () => "Weigh",
        palette: false,
      }),
    ).not.toThrow());
  test("worker access needs palette false and ai false", () => {
    const worker: OperationDescription = {
      id: "agent.claim",
      kind: "mutation",
      label: "Claim",
      description: "x",
      appliesTo: "none",
      input: z.object({}),
      subject: () => null,
      effects: ["updateItem"],
      summary: () => "Claim",
      access: "worker",
    };
    expect(() => describeOperation({ ...worker, ai: false })).toThrow(
      'Operation "agent.claim" has access: "worker" but is in ⌘K or AI',
    );
    expect(() => describeOperation({ ...worker, palette: false })).toThrow(
      OperationError,
    );
    expect(() =>
      describeOperation({ ...worker, palette: false, ai: false }),
    ).not.toThrow();
  });
  test("access slack needs palette false and ai false", () => {
    const slack: OperationDescription = {
      id: "slack.check",
      kind: "query",
      label: "Check",
      description: "x",
      appliesTo: "none",
      input: z.object({}),
      subject: () => null,
      effects: [],
      summary: () => "Check",
      access: "slack",
    };
    expect(() => describeOperation({ ...slack, ai: false })).toThrow(
      'access: "slack"',
    );
    expect(() => describeOperation({ ...slack, palette: false })).toThrow(
      OperationError,
    );
    expect(() =>
      describeOperation({ ...slack, palette: false, ai: false }),
    ).not.toThrow();
  });
  test("access defaults to everyone with ai and user without", () => {
    const d = describeOperation({
      id: "tasks.complete",
      kind: "mutation",
      label: "Complete",
      description: "x",
      appliesTo: ["task"],
      input,
      subject: (i) => i.id,
      effects: ["updateItem"],
      summary: () => "Complete",
    });
    expect(accessOf(d)).toBe("everyone");
    expect(accessOf({ ...d, ai: false })).toBe("user");
    expect(accessOf({ ...d, ai: false, access: "everyone" })).toBe("everyone");
    expect(accessOf({ ...d, access: "user" })).toBe("user");
  });
  test("an object palette checks params, and toInput gets typed params", () => {
    const create = z.object({
      title: z.string(),
      due: fields.due().optional(),
    });
    const d = describeOperation({
      id: "tasks.create",
      kind: "mutation",
      label: "New task",
      description: "Creates a task.",
      appliesTo: "none",
      group: "create",
      input: create,
      subject: () => null,
      effects: ["createItems"],
      summary: (i) => `New task ${i.title}`,
      palette: {
        params: z.object({ title: z.string().describe("Title") }),
        prefill: (ctx) => ({ title: ctx.text }),
        toInput: (_ctx, p) => ({ title: p.title.toUpperCase() }),
      },
    });
    const palette = d.palette;
    if (typeof palette !== "object") throw new Error("expected a form");
    expect(
      palette.toInput(
        { text: "", now: new Date(), timeZone: "UTC" },
        { title: "call" },
      ),
    ).toEqual({ title: "CALL" });
    expect(() =>
      describeOperation({
        ...d,
        palette: {
          params: z.object({ n: z.number() }),
          toInput: () => ({ title: "x" }),
        },
      }),
    ).toThrow(/n/);
  });
});

describe("AI", () => {
  test("removeLinks may run as Do", () =>
    expect(capFor(["removeLinks"])).toBe("do"));
  test("a query becomes an ask action, a mutation suggest and do", () => {
    const base = {
      label: "X",
      description: "Does x.",
      appliesTo: ["task"],
      input,
      subject: (i: { id: string }) => i.id,
      summary: () => "X",
      words: ["x"],
    };
    const q = describeOperation({
      ...base,
      id: "tasks.q",
      kind: "query",
      effects: [],
    });
    const m = describeOperation({
      ...base,
      id: "tasks.m",
      kind: "mutation",
      effects: ["updateItem"],
    });
    expect(toAiAction(q)).toEqual({
      id: "tasks.q",
      label: "X",
      description: "Does x.",
      appliesTo: ["task"],
      kinds: ["ask"],
      effects: [],
      words: ["x"],
    });
    expect(toAiAction(m).kinds).toEqual(["suggest", "do"]);
  });
  test("operationList keeps extra row fields", () => {
    const row = {
      id: "6f1c1f9e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
      type: "task",
      title: "Call",
      archivedAt: null,
      day: "2026-11-06",
    };
    expect(
      operationList.parse({ heading: "Due", items: [row] }).items[0],
    ).toEqual(row);
  });
});

describe("registry", () => {
  const op = (id: string, ai?: boolean) =>
    describeOperation({
      id,
      kind: "mutation",
      label: id,
      description: "Does it.",
      appliesTo: ["task"],
      input,
      subject: (i) => i.id,
      effects: ["updateItem"],
      summary: () => id,
      ai,
    });
  test("derives AI actions from operations and skips ai: false", () => {
    const r = collectModules([
      defineModule({
        id: "tasks",
        routes: () => [],
        operations: [op("tasks.complete"), op("tasks.reorderMany", false)],
      }),
    ]);
    expect(r.operations.map((o) => o.id)).toEqual([
      "tasks.complete",
      "tasks.reorderMany",
    ]);
    expect(r.aiActions.map((a) => a.id)).toEqual(["tasks.complete"]);
  });
  test("duplicate operation ids throw", () =>
    expect(() =>
      collectModules([
        defineModule({ id: "a", routes: () => [], operations: [op("x.y")] }),
        defineModule({
          id: "b",
          routes: () => [],
          operations: [op("x.y", false)],
        }),
      ]),
    ).toThrow(ModuleRegistryError));
  test("an operation id clashing with an AI action id throws", () =>
    expect(() =>
      collectModules([
        defineModule({
          id: "a",
          routes: () => [],
          operations: [op("a.go")],
          aiActions: [{ ...toAiAction(op("a.go")) }],
        }),
      ]),
    ).toThrow(/a\.go/));
});

describe("dueFromLocal", () => {
  const la = "America/Los_Angeles";
  test("a wall time is set at the zone's offset that day, DST included", () => {
    expect(dueFromLocal({ dateTime: "2026-11-06T09:00" }, la)).toEqual({
      dateTime: "2026-11-06T09:00:00-08:00",
      timeZone: la,
    });
    expect(dueFromLocal({ dateTime: "2026-10-30T09:00" }, la)).toEqual({
      dateTime: "2026-10-30T09:00:00-07:00",
      timeZone: la,
    });
    expect(
      dueFromLocal({ dateTime: "2026-11-06T09:00" }, "Asia/Kolkata"),
    ).toEqual({
      dateTime: "2026-11-06T09:00:00+05:30",
      timeZone: "Asia/Kolkata",
    });
  });
  test("a repeated hour is its first time; a skipped hour lands after it", () => {
    expect(dueFromLocal({ dateTime: "2026-11-01T01:30" }, la)).toMatchObject({
      dateTime: "2026-11-01T01:30:00-07:00",
    });
    expect(dueFromLocal({ dateTime: "2026-03-08T02:30" }, la)).toMatchObject({
      dateTime: "2026-03-08T03:30:00-07:00",
    });
  });
  test("a day stays a day; the model's schema has no offset", () => {
    expect(dueFromLocal({ date: "2026-11-06" }, la)).toEqual({
      date: "2026-11-06",
    });
    expect(
      localDueValue.safeParse({ dateTime: "2026-11-06T09:00-08:00" }).success,
    ).toBe(false);
    expect(
      localDueValue.safeParse({ dateTime: "2026-11-06T09:00" }).success,
    ).toBe(true);
  });
});

test("itemOnScreen gives the versioned keys, or NotReady with nothing on screen", () => {
  const ctx = { text: "", now: new Date(), timeZone: "UTC" };
  expect(
    itemOnScreen({
      ...ctx,
      item: { id: "a", type: "task", updatedAt: "2026-11-02T09:00:00.000Z" },
    }),
  ).toEqual({ id: "a", expectedUpdatedAt: "2026-11-02T09:00:00.000Z" });
  expect(() => itemOnScreen(ctx)).toThrow(NotReady);
});
