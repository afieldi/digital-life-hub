import { addDays } from "@dlh/core";
import {
  apply,
  complete,
  devFakeAi,
  MAX_CONTEXT_CHARS,
  prepare,
  runMutation,
  undo,
} from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([tasksServer]);
  const { deps, operations } = testServer(t.db, [tasksServer], {
    itemTypes: ["note"],
  });
  const create = operations.get("tasks.create");
  if (create?.kind !== "mutation") throw new Error("no tasks.create");
  const mk = async (input: {
    title: string;
    notes?: string;
    parentId?: string;
    due?: { date: string };
    priority?: "medium" | "high";
  }) =>
    (await runMutation(deps, create, input)).result as {
      id: string;
      updatedAt: string;
    };
  /** Moves the frozen clock on, so a later write gets a later version. */
  const tick = () => deps.setNow(new Date(deps.now().getTime() + 1000));
  return { ...t, deps, operations, create, mk, tick };
}

type Db = Awaited<ReturnType<typeof setup>>["db"];

/** Live subtasks of `parentId`, by title. */
async function liveSubtasks(db: Db, parentId: string): Promise<string[]> {
  const rows = await db.execute<{ title: string }>(sql`
    select i.title from links l
    join items i on i.id = l.to_id and i.deleted_at is null
    where l.from_id = ${parentId} and l.kind = 'contains'
    order by i.title`);
  return rows.map((r) => r.title);
}

async function notesOf(db: Db, id: string): Promise<string | null> {
  const [row] = await db.execute<{ notes: string | null }>(
    sql`select notes from tasks where item_id = ${id}`,
  );
  return row?.notes ?? null;
}

test("addParent via AI links the parent it names to the task on screen, with Undo", async () => {
  const s = await setup();
  const a = await s.mk({ title: "Buy milk" });
  const g = await s.mk({ title: "Groceries" });
  const containsLink = () =>
    s.db.execute(
      sql`select id from links where from_id = ${g.id} and to_id = ${a.id} and kind = 'contains'`,
    );

  s.deps.fakeProvider.queue(JSON.stringify({ parentId: "Groceries" }));
  const res = await prepare(s.deps, {
    text: "make this a subtask of groceries",
    itemId: a.id,
    actionId: "tasks.addParent",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied" });
  expect(await containsLink()).toHaveLength(1);

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await containsLink()).toHaveLength(0);
  await s.close();
});

test("breakDown do creates subtasks and Undo removes them", async () => {
  const s = await setup();
  const trip = await s.mk({ title: "Plan the trip", notes: "Lisbon in May" });
  await s.mk({ title: "Book flights", parentId: trip.id });

  s.deps.fakeProvider.queue(
    JSON.stringify({ subtasks: ["Book hotel", "Pack bags", "Get euros"] }),
  );
  const res = await prepare(s.deps, {
    text: "break this into subtasks",
    itemId: trip.id,
    actionId: "tasks.breakDown",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied", summary: "Added 3 subtasks" });
  // The model saw the notes and the subtask already there.
  const prompt = s.deps.fakeProvider.calls[0]?.prompt ?? "";
  expect(prompt).toContain("Lisbon in May");
  expect(prompt).toContain("Book flights");
  expect(await liveSubtasks(s.db, trip.id)).toEqual([
    "Book flights",
    "Book hotel",
    "Get euros",
    "Pack bags",
  ]);

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await liveSubtasks(s.db, trip.id)).toEqual(["Book flights"]);
  const [created] = await s.db.execute<{ n: number }>(sql`
    select count(*)::int as n from items
    where title in ('Book hotel', 'Pack bags', 'Get euros') and deleted_at is not null`);
  expect(created?.n).toBe(3);
  await s.close();
});

test("breakDown suggest creates the ticked ones", async () => {
  const s = await setup();
  const trip = await s.mk({ title: "Plan the trip" });
  s.deps.fakeProvider.queue(
    JSON.stringify({
      options: [
        { label: "Book hotel" },
        { label: "Pack bags" },
        { label: "Get euros" },
        { label: "Renew passport" },
      ],
    }),
  );
  const res = await prepare(s.deps, {
    text: "suggest some subtasks",
    itemId: trip.id,
    actionId: "tasks.breakDown",
    kind: "suggest",
  });
  // All of them are offered as a checklist, not the usual three.
  expect(res).toMatchObject({
    status: "suggested",
    multiSelect: true,
    options: [
      { label: "Book hotel" },
      { label: "Pack bags" },
      { label: "Get euros" },
      { label: "Renew passport" },
    ],
  });
  const applied = await apply(s.deps, {
    requestId: res.requestId,
    options: [0, 2, 0],
  });
  expect(applied.summary).toBe("Added 2 subtasks");
  expect(await liveSubtasks(s.db, trip.id)).toEqual([
    "Book hotel",
    "Get euros",
  ]);
  // Applied once: the rest can't be added later from the same suggestion.
  await expect(
    apply(s.deps, { requestId: res.requestId, options: [1] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await liveSubtasks(s.db, trip.id)).toEqual([]);
  await s.close();
});

test("breakDown suggest refuses an option index it didn't offer", async () => {
  const s = await setup();
  const trip = await s.mk({ title: "Plan the trip" });
  s.deps.fakeProvider.queue(
    JSON.stringify({
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    }),
  );
  const res = await prepare(s.deps, {
    text: "suggest some subtasks",
    itemId: trip.id,
    actionId: "tasks.breakDown",
    kind: "suggest",
  });
  await expect(
    apply(s.deps, { requestId: res.requestId, options: [0, 5] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await liveSubtasks(s.db, trip.id)).toEqual([]);
  // Still suggested: a valid pick works after a refused one.
  await apply(s.deps, { requestId: res.requestId, options: [1] });
  expect(await liveSubtasks(s.db, trip.id)).toEqual(["B"]);
  await s.close();
});

test("breakDown on a subtask refuses", async () => {
  const s = await setup();
  const trip = await s.mk({ title: "Plan the trip" });
  const flights = await s.mk({ title: "Book flights", parentId: trip.id });
  await expect(
    prepare(s.deps, {
      text: "break this down",
      itemId: flights.id,
      actionId: "tasks.breakDown",
      kind: "do",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Subtasks can't have subtasks",
  });
  expect(s.deps.fakeProvider.calls).toHaveLength(0);
  await s.close();
});

test("rewriteNotes do and undo", async () => {
  const s = await setup();
  const task = await s.mk({
    title: "Call the bank",
    notes: "ask abt the fee thing, acct ending 42",
  });
  s.deps.fakeProvider.queue(
    JSON.stringify({ notes: "Ask about the fee on the account ending 42." }),
  );
  const res = await prepare(s.deps, {
    text: "rewrite the notes",
    itemId: task.id,
    actionId: "tasks.rewriteNotes",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied" });
  expect(await notesOf(s.db, task.id)).toBe(
    "Ask about the fee on the account ending 42.",
  );

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await notesOf(s.db, task.id)).toBe(
    "ask abt the fee thing, acct ending 42",
  );

  // Suggest offers exactly two versions; applying one replaces the notes.
  s.tick();
  s.deps.fakeProvider.queue(
    JSON.stringify({
      options: [
        { label: "Shorter", notes: "Ask about the fee (acct 42)." },
        { label: "Clearer", notes: "Ask the bank about the fee." },
      ],
    }),
  );
  const sug = await prepare(s.deps, {
    text: "suggest clearer notes",
    itemId: task.id,
    actionId: "tasks.rewriteNotes",
    kind: "suggest",
  });
  // Each version's text shows under its label, to read before picking.
  expect(sug).toMatchObject({
    status: "suggested",
    options: [
      { label: "Shorter", reason: "Ask about the fee (acct 42)." },
      { label: "Clearer", reason: "Ask the bank about the fee." },
    ],
  });
  expect(sug).not.toHaveProperty("multiSelect");
  // Two versions of the notes can't both apply: one option at a time.
  await expect(
    apply(s.deps, { requestId: sug.requestId, options: [0, 1] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await apply(s.deps, { requestId: sug.requestId, option: 1 });
  expect(await notesOf(s.db, task.id)).toBe("Ask the bank about the fee.");
  await s.close();
});

const ZONE = "America/Los_Angeles";

test("planToday caps context at 60, keeping all of today's", async () => {
  const s = await setup();
  // The test clock is 2026-10-30 12:00 UTC: Oct 30 in Los Angeles.
  for (let n = 0; n < 69; n++) {
    await s.mk({ title: `Late ${n}`, due: { date: addDays("2026-08-01", n) } });
  }
  const first = await s.mk({
    title: "Overdue one",
    due: { date: "2026-10-29" },
    priority: "high",
  });
  await s.mk({ title: "Step one", parentId: first.id });
  for (let n = 0; n < 5; n++) {
    await s.mk({ title: `Today ${n}`, due: { date: "2026-10-30" } });
  }
  await s.mk({ title: "Tomorrow one", due: { date: "2026-10-31" } });
  await s.mk({ title: "Way later", due: { date: "2026-11-20" } });
  await s.mk({ title: "No date" });
  // Evening of Oct 30 in Los Angeles, already Oct 31 in UTC: days are read in the device's zone.
  s.deps.setNow(new Date("2026-10-31T03:00:00.000Z"));

  s.deps.fakeProvider.queue(
    JSON.stringify({
      order: [{ taskId: first.id, reason: "It's late" }],
      advice: "Start with the late one.",
    }),
  );
  const res = await prepare(s.deps, {
    text: "plan my day",
    actionId: "tasks.planToday",
    kind: "ask",
    timeZone: ZONE,
  });
  expect(res).toMatchObject({
    status: "listed",
    heading: "Start with the late one.",
    items: [
      { id: first.id, title: "Overdue one", type: "task", note: "It's late" },
    ],
  });
  const prompt = s.deps.fakeProvider.calls[0]?.prompt ?? "";
  const lines = prompt.split("\n").filter((l) => l.startsWith("- "));
  expect(lines).toHaveLength(60);
  // Today's five, then the 55 most recent overdue, shown in day order.
  expect(lines.filter((l) => / · Today · /.test(l))).toHaveLength(5);
  expect(lines[0]).toMatch(/^- Late 15 · /);
  expect(lines[54]).toBe(
    `- Overdue one · Yesterday · high · 0/1 subtasks (id ${first.id})`,
  );
  expect(lines[55]).toMatch(/^- Today 0 · Today · medium · no subtasks \(id /);
  expect(prompt).not.toContain("Late 14 ");
  expect(prompt).not.toContain("Tomorrow one");
  expect(prompt).not.toContain("Way later");
  expect(prompt).not.toContain("No date");
  await s.close();
});

test("planToday cuts long titles and stays within the context budget", async () => {
  const s = await setup();
  const long = "x".repeat(490);
  for (let n = 0; n < 60; n++) {
    await s.mk({ title: `${n} ${long}`, due: { date: "2026-10-30" } });
  }
  s.deps.fakeProvider.queue(JSON.stringify({ order: [], advice: "" }));
  const res = await prepare(s.deps, {
    text: "plan my day",
    actionId: "tasks.planToday",
    kind: "ask",
    timeZone: ZONE,
  });
  expect(res).toMatchObject({ heading: "Plan for today", items: [] });
  const prompt = s.deps.fakeProvider.calls[0]?.prompt ?? "";
  const context = prompt.slice(
    prompt.indexOf("<item>\n") + "<item>\n".length,
    prompt.indexOf("\n</item>"),
  );
  expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  const lines = context.split("\n").filter((l) => l.startsWith("- "));
  expect(lines.length).toBeGreaterThan(0);
  expect(lines[0]).toMatch(/^- \d+ x+… · Today · /);
  expect(lines[0]).not.toContain(long);
  await s.close();
});

test("planToday rejects unknown ids", async () => {
  const s = await setup();
  const known = await s.mk({ title: "Known", due: { date: "2026-10-30" } });
  const later = await s.mk({ title: "Later", due: { date: "2026-11-20" } });
  s.deps.fakeProvider.queue(
    JSON.stringify({
      order: [
        { taskId: known.id, reason: "Due today" },
        { taskId: later.id, reason: "Not in the context" },
      ],
      advice: "",
    }),
  );
  await expect(
    prepare(s.deps, {
      text: "what should I do first today?",
      actionId: "tasks.planToday",
      kind: "ask",
      timeZone: ZONE,
    }),
  ).rejects.toMatchObject({ cause: { code: "bad_output" } });
  await s.close();
});

test("planToday checks the answer against what the model saw: a task ticked since shows done, a deleted one is dropped", async () => {
  const s = await setup();
  const ticked = await s.mk({ title: "Ticked", due: { date: "2026-10-30" } });
  const gone = await s.mk({ title: "Gone", due: { date: "2026-10-30" } });
  const open = await s.mk({ title: "Open", due: { date: "2026-10-30" } });
  const run = await prepare(s.deps, {
    text: "plan my day",
    actionId: "tasks.planToday",
    kind: "ask",
    provider: "claude-cli",
    timeZone: ZONE,
  });
  if (run.status !== "run") throw new Error("expected a CLI run");

  // While the CLI runs: one task is ticked, one deleted.
  s.tick();
  const complete_ = s.operations.get("tasks.complete");
  if (complete_?.kind !== "mutation") throw new Error("no tasks.complete");
  await runMutation(s.deps, complete_, {
    id: ticked.id,
    expectedUpdatedAt: ticked.updatedAt,
  });
  await s.db.execute(
    sql`update items set deleted_at = now() where id = ${gone.id}`,
  );

  const res = await complete(s.deps, {
    requestId: run.requestId,
    raw: JSON.stringify({
      type: "result",
      is_error: false,
      result: JSON.stringify({
        order: [
          { taskId: ticked.id, reason: "Quick" },
          { taskId: gone.id, reason: "Was due" },
          { taskId: open.id, reason: "Then this" },
        ],
        advice: "Go.",
      }),
    }),
  });
  expect(res).toMatchObject({
    status: "listed",
    items: [
      { id: ticked.id, done: true },
      { id: open.id, title: "Open" },
    ],
  });
  if (res.status !== "listed") throw new Error();
  expect(res.items).toHaveLength(2);
  expect(res.items[1]?.done).toBeUndefined();
  await s.close();
});

test("the dev fake answers each hand-written Tasks action", async () => {
  const s = await setup();
  s.deps.ai.providers = devFakeAi.providers;
  const trip = await s.mk({
    title: "Plan the trip",
    notes: "lisbon, may",
    due: { date: "2026-10-30" },
  });
  const run = (actionId: string, kind: "ask" | "suggest" | "do") =>
    prepare(s.deps, {
      text: "x",
      itemId: actionId === "tasks.planToday" ? undefined : trip.id,
      actionId,
      kind,
      timeZone: ZONE,
    });

  expect(await run("tasks.breakDown", "suggest")).toMatchObject({
    status: "suggested",
    options: [{}, {}, {}],
  });
  expect(await run("tasks.rewriteNotes", "suggest")).toMatchObject({
    status: "suggested",
    options: [{}, {}],
  });
  expect(await run("tasks.planToday", "ask")).toMatchObject({
    status: "listed",
    items: [{ id: trip.id }],
  });
  expect(await run("tasks.breakDown", "do")).toMatchObject({
    status: "applied",
  });
  expect(await liveSubtasks(s.db, trip.id)).toHaveLength(3);
  expect(await run("tasks.rewriteNotes", "do")).toMatchObject({
    status: "applied",
  });
  expect(await notesOf(s.db, trip.id)).toBe("Fake rewritten notes.");
  await s.close();
});

test("a due the model gives as local wall time is set in the request's zone", async () => {
  const s = await setup();
  const a = await s.mk({ title: "Call the vet" });
  const dueOf = async () => {
    const [row] = await s.db.execute<{ due_at: Date | string; due_tz: string }>(
      sql`select due_at, due_tz from tasks where item_id = ${a.id}`,
    );
    return { at: new Date(row?.due_at ?? 0).toISOString(), tz: row?.due_tz };
  };

  s.deps.fakeProvider.queue(
    JSON.stringify({ due: { dateTime: "2026-11-06T09:00" } }),
  );
  const res = await prepare(s.deps, {
    text: "move this to friday 9am",
    itemId: a.id,
    actionId: "tasks.reschedule",
    kind: "do",
    timeZone: "America/Los_Angeles",
  });
  expect(res).toMatchObject({
    status: "applied",
    summary: "Reschedule to Fri, Nov 6 9:00",
  });
  // 9:00 PST, after the clocks went back on Nov 1.
  expect(await dueOf()).toEqual({
    at: "2026-11-06T17:00:00.000Z",
    tz: "America/Los_Angeles",
  });
  // The model is told the local time, and to answer in it.
  const call = s.deps.fakeProvider.calls[0];
  expect(call?.prompt).toMatch(
    /^Today is \w+, \w+ \d+, \d{4}, \d{1,2}:\d{2} \(America\/Los_Angeles\)\./,
  );
  expect(JSON.stringify(call?.schema)).toContain("local time");

  s.tick();
  s.deps.fakeProvider.queue(
    JSON.stringify({ due: { dateTime: "2026-10-30T09:00" } }),
  );
  await prepare(s.deps, {
    text: "move this to oct 30 9am",
    itemId: a.id,
    actionId: "tasks.reschedule",
    kind: "do",
    timeZone: "America/Los_Angeles",
  });
  // 9:00 PDT, before the change.
  expect((await dueOf()).at).toBe("2026-10-30T16:00:00.000Z");

  // An offset is the model guessing the zone: refused.
  s.tick();
  s.deps.fakeProvider.queue(
    JSON.stringify({ due: { dateTime: "2026-11-06T09:00:00-07:00" } }),
  );
  const bad = await prepare(s.deps, {
    text: "move this to friday 9am",
    itemId: a.id,
    actionId: "tasks.reschedule",
    kind: "do",
    timeZone: "America/Los_Angeles",
  }).catch((e: unknown) => e);
  expect(bad).toMatchObject({ cause: { code: "bad_output" } });
  await s.close();
});

test("a CLI do keeps the zone until complete, for the due it converts", async () => {
  const s = await setup();
  const a = await s.mk({ title: "Call the vet" });
  const run = await prepare(s.deps, {
    text: "move this to friday 9am",
    itemId: a.id,
    actionId: "tasks.reschedule",
    kind: "do",
    provider: "claude-cli",
    timeZone: "Asia/Tokyo",
  });
  if (run.status !== "run") throw new Error("expected a CLI run");
  const res = await complete(s.deps, {
    requestId: run.requestId,
    raw: JSON.stringify({
      type: "result",
      is_error: false,
      result: JSON.stringify({ due: { dateTime: "2026-11-06T09:00" } }),
    }),
  });
  expect(res).toMatchObject({ status: "applied" });
  const [row] = await s.db.execute<{ due_at: Date | string; due_tz: string }>(
    sql`select due_at, due_tz from tasks where item_id = ${a.id}`,
  );
  expect(new Date(row?.due_at ?? 0).toISOString()).toBe(
    "2026-11-06T00:00:00.000Z",
  );
  expect(row?.due_tz).toBe("Asia/Tokyo");
  await s.close();
});
