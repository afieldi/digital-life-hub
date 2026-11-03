import { type Due, todayIn } from "@dlh/core";
import { type CoreDeps, writeItems } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { groupFor } from "../src/dates";
import type { TaskRow } from "../src/schema";
import tasksServer from "../src/server";
import { dueBetween, dueBetweenQuery } from "../src/server/reads";

const LA = "America/Los_Angeles";
/** Mon, Nov 2, 2026, 09:00 in Los Angeles (PST, -08:00). */
const NOW = new Date("2026-11-02T17:00:00.000Z");

async function setup() {
  const t = await freshModuleDb([tasksServer]);
  const { deps, caller } = testServer(t.db, [tasksServer], {
    itemTypes: ["note"],
    now: () => NOW,
  });
  const mk = async (
    title: string,
    extra: { parentId?: string; due?: Due } = {},
  ) => (await caller.tasks.create({ title, ...extra })).result;
  /** Completes `id` at `at` (the server's clock), then puts the clock back. */
  const completeAt = async (id: string, at: Date) => {
    deps.setNow(at);
    await caller.tasks.complete({
      id,
      expectedUpdatedAt: await version(deps, id),
    });
    deps.setNow(NOW);
  };
  return { ...t, deps, caller, mk, completeAt };
}

/** The item's current version, as the API sends it. */
async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

async function softDelete(deps: CoreDeps, id: string) {
  await writeItems(deps, async (w) =>
    w.setDeleted({
      id,
      expectedUpdatedAt: await version(deps, id),
      deleted: true,
    }),
  );
}

const titles = (rows: TaskRow[]) => rows.map((r) => r.title);
const byTitle = (rows: TaskRow[], title: string) => {
  const row = rows.find((r) => r.title === title);
  if (!row) throw new Error(`no row ${title}`);
  return row;
};

test("open groups overdue, today, week, later, none in the given zone", async () => {
  const { caller, mk, completeAt, close } = await setup();
  await mk("Overdue day", { due: { date: "2026-10-30" } });
  // Sun, Nov 1, 22:00 in LA, but already Nov 2 in UTC.
  await mk("Overdue last night", {
    due: { dateTime: "2026-11-02T06:00:00Z", timeZone: LA },
  });
  await mk("Today", { due: { date: "2026-11-02" } });
  await mk("Thursday", { due: { date: "2026-11-05" } });
  await mk("Next week", { due: { date: "2026-11-12" } });
  await mk("Someday");
  const doneToday = await mk("Done today", { due: { date: "2026-11-02" } });
  await completeAt(doneToday.id, new Date("2026-11-02T16:00:00Z"));
  // Sun, Nov 1, 23:00 in LA: done before today there.
  const doneYesterday = await mk("Done yesterday");
  await completeAt(doneYesterday.id, new Date("2026-11-02T07:00:00Z"));

  const { rows, nextCursor } = await caller.tasks.list({
    view: "open",
    timeZone: LA,
  });
  expect(nextCursor).toBeUndefined();
  const today = todayIn(NOW, LA);
  expect(
    Object.fromEntries(rows.map((r) => [r.title, groupFor(r.day, today)])),
  ).toEqual({
    "Overdue day": "overdue",
    "Overdue last night": "overdue",
    Today: "today",
    "Done today": "today",
    Thursday: "week",
    "Next week": "later",
    Someday: "none",
  });
  expect(byTitle(rows, "Overdue last night").day).toBe("2026-11-01");
  expect(byTitle(rows, "Done today").completedAt).toBe(
    "2026-11-02T16:00:00.000Z",
  );
  expect(byTitle(rows, "Someday")).toMatchObject({
    due: null,
    priority: "medium",
    notes: null,
    subtasks: { total: 0, done: 0, next: null },
    parents: [],
    linkedNotes: 0,
  });

  // The same tasks in UTC: last night's task is due today there.
  const utc = await caller.tasks.list({ view: "open", timeZone: "UTC" });
  expect(byTitle(utc.rows, "Overdue last night").day).toBe("2026-11-02");
  await close();
});

test("a dated subtask appears under its day with its parent", async () => {
  const { caller, mk, close } = await setup();
  const parent = await mk("Review vendor contracts");
  const other = await mk("Quarter close");
  const sub = await mk("List questions for legal", {
    parentId: parent.id,
    due: { date: "2026-11-04" },
  });
  await caller.tasks.addParent({ id: sub.id, parentId: other.id });

  const { rows } = await caller.tasks.list({ view: "open", timeZone: LA });
  expect(byTitle(rows, "List questions for legal")).toMatchObject({
    day: "2026-11-04",
    parents: [
      {
        id: parent.id,
        type: "task",
        title: "Review vendor contracts",
        archivedAt: null,
      },
      { id: other.id, type: "task", title: "Quarter close", archivedAt: null },
    ],
  });
  expect(byTitle(rows, "Review vendor contracts").subtasks).toEqual({
    total: 1,
    done: 0,
    next: "List questions for legal",
  });
  await close();
});

test("an undated subtask only counts on its parent", async () => {
  const { caller, mk, completeAt, close } = await setup();
  const parent = await mk("Review vendor contracts");
  const a = await mk("Collect contracts", { parentId: parent.id });
  await mk("List questions for legal", { parentId: parent.id });
  const c = await mk("Compare renewal terms", { parentId: parent.id });
  await mk("Send summary to finance", { parentId: parent.id });
  await completeAt(a.id, NOW);
  await completeAt(c.id, NOW);
  // A shared subtask counts under every parent.
  const other = await mk("Quarter close");
  await caller.tasks.addParent({ id: c.id, parentId: other.id });

  const { rows } = await caller.tasks.list({ view: "open", timeZone: LA });
  expect(titles(rows).sort()).toEqual(
    ["Quarter close", "Review vendor contracts"].sort(),
  );
  expect(byTitle(rows, "Review vendor contracts").subtasks).toEqual({
    total: 4,
    done: 2,
    next: "List questions for legal",
  });
  expect(byTitle(rows, "Quarter close").subtasks).toEqual({
    total: 1,
    done: 1,
    next: null,
  });
  await close();
});

test("deleted parents and subtasks are hidden", async () => {
  const { deps, caller, mk, close } = await setup();
  const parent = await mk("Parent");
  const other = await mk("Other");
  const kept = await mk("Kept", { parentId: parent.id });
  const dated = await mk("Dated", {
    parentId: parent.id,
    due: { date: "2026-11-04" },
  });
  for (const id of [kept.id, dated.id]) {
    await caller.tasks.addParent({ id, parentId: other.id });
  }
  const gone = await mk("Gone", { parentId: parent.id });
  await softDelete(deps, gone.id);

  let { rows } = await caller.tasks.list({ view: "open", timeZone: LA });
  expect(titles(rows)).toEqual(["Dated", "Parent", "Other"]);
  expect(byTitle(rows, "Parent").subtasks).toEqual({
    total: 2,
    done: 0,
    next: "Kept",
  });

  // Shared subtasks stay with their other parent; the deleted one is gone.
  await softDelete(deps, parent.id);
  ({ rows } = await caller.tasks.list({ view: "open", timeZone: LA }));
  expect(titles(rows)).toEqual(["Dated", "Other"]);
  expect(byTitle(rows, "Dated").parents.map((p) => p.title)).toEqual(["Other"]);
  expect(byTitle(rows, "Other").subtasks.total).toBe(2);
  await expect(caller.tasks.get({ id: parent.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });

  // Its other parent dropped, "Kept" has no live task parent and shows on its own.
  await caller.tasks.removeParent({ id: kept.id, parentId: other.id });
  ({ rows } = await caller.tasks.list({ view: "open", timeZone: LA }));
  expect(titles(rows)).toEqual(["Dated", "Other", "Kept"]);
  expect(byTitle(rows, "Kept").parents).toEqual([]);
  await close();
});

test("ordering: timed tasks by due_at first, then any-time tasks by sort_key", async () => {
  const { caller, mk, close } = await setup();
  await mk("Any A", { due: { date: "2026-11-03" } });
  await mk("15:00", { due: { dateTime: "2026-11-03T15:00:00-08:00" } });
  await mk("09:00", { due: { dateTime: "2026-11-03T09:00:00-08:00" } });
  const b = await mk("Any B", { due: { date: "2026-11-03" } });
  await mk("No date C");
  const d = await mk("No date D");
  await mk("Earlier day", { due: { date: "2026-11-02" } });
  for (const id of [b.id, d.id]) {
    await caller.tasks.reorder({
      id,
      expectedUpdatedAt: (await caller.tasks.get({ id })).task.updatedAt,
      position: "top",
    });
  }

  const { rows } = await caller.tasks.list({ view: "open", timeZone: LA });
  expect(titles(rows)).toEqual([
    "Earlier day",
    "09:00",
    "15:00",
    "Any B",
    "Any A",
    "No date D",
    "No date C",
  ]);
  await close();
});

test("upcoming week of 2026-11-02 plus later", async () => {
  const { caller, mk, completeAt, close } = await setup();
  await mk("Overdue", { due: { date: "2026-10-30" } });
  await mk("Sunday late", {
    due: { dateTime: "2026-11-08T23:00:00-08:00", timeZone: LA },
  });
  await mk("Monday", { due: { date: "2026-11-02" } });
  await mk("Later", { due: { date: "2026-11-20" } });
  await mk("Next Monday", { due: { date: "2026-11-09" } });
  await mk("Someday");
  const done = await mk("Done Tuesday", { due: { date: "2026-11-03" } });
  await completeAt(done.id, NOW);

  // Any day of the week selects that week.
  const { rows } = await caller.tasks.list({
    view: "upcoming",
    timeZone: LA,
    weekOf: "2026-11-04",
  });
  expect(rows.map((r) => [r.title, r.day])).toEqual([
    ["Monday", "2026-11-02"],
    ["Sunday late", "2026-11-08"],
    ["Next Monday", "2026-11-09"],
    ["Later", "2026-11-20"],
  ]);
  await expect(
    caller.tasks.list({ view: "upcoming", timeZone: LA }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("done pages and groups by completion day", async () => {
  const { caller, mk, completeAt, close } = await setup();
  // Completed every 30 minutes from Sat, Oct 31, 23:00 in LA.
  const start = new Date("2026-11-01T06:00:00Z").getTime();
  for (let i = 0; i < 55; i++) {
    const t = await mk(`Done ${i}`);
    await completeAt(t.id, new Date(start + i * 30 * 60_000));
  }
  await mk("Still open");

  const first = await caller.tasks.list({ view: "done", timeZone: LA });
  expect(first.rows).toHaveLength(50);
  expect(first.rows[0]?.title).toBe("Done 54");
  expect(first.rows[49]?.title).toBe("Done 5");
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await caller.tasks.list({
    view: "done",
    timeZone: LA,
    cursor: first.nextCursor,
  });
  expect(titles(second.rows)).toEqual([
    "Done 4",
    "Done 3",
    "Done 2",
    "Done 1",
    "Done 0",
  ]);
  expect(second.nextCursor).toBeUndefined();

  // The app groups by the day each was completed, in its zone.
  const days = [...first.rows, ...second.rows].map((r) =>
    todayIn(new Date(r.completedAt ?? ""), LA),
  );
  expect([...new Set(days)]).toEqual([
    "2026-11-02",
    "2026-11-01",
    "2026-10-31",
  ]);
  expect(days.filter((d) => d === "2026-10-31")).toHaveLength(2);

  await expect(
    caller.tasks.list({ view: "done", timeZone: LA, cursor: "nonsense" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("done lists completed undated subtasks too, as stats counts them", async () => {
  const { caller, mk, completeAt, close } = await setup();
  const trip = await mk("Plan the trip");
  const flights = await mk("Book flights", { parentId: trip.id });
  await completeAt(flights.id, NOW);
  const { rows } = await caller.tasks.list({ view: "done", timeZone: LA });
  expect(titles(rows)).toEqual(["Book flights"]);
  expect(rows[0]?.parents.map((p) => p.title)).toEqual(["Plan the trip"]);
  const stats = await caller.tasks.stats({
    timeZone: LA,
    weekOf: "2026-11-02",
  });
  const today = stats.perDay.find((d) => d.day === "2026-11-02");
  expect(today?.count).toBe(rows.length);
  await close();
});

test("stats counts on time and overdue cleared", async () => {
  const { caller, mk, completeAt, close } = await setup();
  const onTime = await mk("On time", { due: { date: "2026-11-03" } });
  await completeAt(onTime.id, new Date("2026-11-02T18:00:00Z"));
  const late = await mk("Late", { due: { date: "2026-10-30" } });
  await completeAt(late.id, new Date("2026-11-03T18:00:00Z"));
  const undated = await mk("Undated");
  await completeAt(undated.id, new Date("2026-11-03T19:00:00Z"));
  // Due Wed 09:00 in LA, done Wed 20:00 in LA: on time there, though Thu in UTC.
  const evening = await mk("Same evening", {
    due: { dateTime: "2026-11-04T09:00:00-08:00", timeZone: LA },
  });
  await completeAt(evening.id, new Date("2026-11-05T04:00:00Z"));
  const lastWeek = await mk("Last week");
  await completeAt(lastWeek.id, new Date("2026-10-28T18:00:00Z"));
  // Sun, Nov 1, 23:30 in LA: last week there.
  const sundayNight = await mk("Sunday night");
  await completeAt(sundayNight.id, new Date("2026-11-02T07:30:00Z"));
  const gone = await mk("Deleted");
  await completeAt(gone.id, new Date("2026-11-03T18:00:00Z"));
  await caller.items.delete({
    id: gone.id,
    expectedUpdatedAt: (await caller.tasks.get({ id: gone.id })).task.updatedAt,
  });

  const stats = await caller.tasks.stats({
    timeZone: LA,
    weekOf: "2026-11-02",
  });
  expect(stats).toEqual({
    perDay: [
      { day: "2026-11-02", count: 1 },
      { day: "2026-11-03", count: 2 },
      { day: "2026-11-04", count: 1 },
      { day: "2026-11-05", count: 0 },
      { day: "2026-11-06", count: 0 },
      { day: "2026-11-07", count: 0 },
      { day: "2026-11-08", count: 0 },
    ],
    done: 4,
    onTime: 2,
    overdueCleared: 1,
    lastWeek: 2,
  });
  await close();
});

test("due friday in LA", async () => {
  const { caller, mk, completeAt, close } = await setup();
  await mk("Friday", { due: { date: "2026-11-06" } });
  // Fri 23:00 in LA is Sat in UTC; Sat 01:00 UTC is Fri 17:00 in LA.
  await mk("Friday night", {
    due: { dateTime: "2026-11-06T23:00:00-08:00", timeZone: LA },
  });
  await mk("Friday afternoon", { due: { dateTime: "2026-11-07T01:00:00Z" } });
  await mk("Saturday", {
    due: { dateTime: "2026-11-07T09:00:00-08:00", timeZone: LA },
  });
  await mk("Thursday", { due: { date: "2026-11-05" } });
  const done = await mk("Done Friday", { due: { date: "2026-11-06" } });
  await completeAt(done.id, NOW);

  const input = { from: "2026-11-06", to: "2026-11-07", timeZone: LA };
  const open = await caller.tasks.due(input);
  expect(open.heading).toBe("Due Fri, Nov 6");
  expect(open.items.map((i) => i.title)).toEqual([
    "Friday afternoon",
    "Friday night",
    "Friday",
  ]);
  expect(open.items[0]).toMatchObject({
    type: "task",
    archivedAt: null,
    day: "2026-11-06",
  });
  const all = await caller.tasks.due({ ...input, include: "all" });
  expect(all.items.map((i) => i.title)).toContain("Done Friday");

  const week = await caller.tasks.due({
    from: "2026-11-02",
    to: "2026-11-09",
    timeZone: LA,
  });
  expect(week.heading).toBe("Due Nov 2 – 8");
  expect(week.items).toHaveLength(5);
  await expect(
    caller.tasks.due({ from: "2026-11-07", to: "2026-11-06", timeZone: LA }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.tasks.due({ ...input, timeZone: "Mars/Olympus" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("get returns the task, its subtasks in order, and its parents", async () => {
  const { caller, mk, close } = await setup();
  const parent = await mk("Parent", { due: { date: "2026-11-04" } });
  const a = await mk("A", { parentId: parent.id });
  const b = await mk("B", { parentId: parent.id });
  await caller.tasks.reorder({
    id: b.id,
    expectedUpdatedAt: (await caller.tasks.get({ id: b.id })).task.updatedAt,
    position: "top",
  });

  const got = await caller.tasks.get({ id: parent.id });
  expect(got.task).toMatchObject({
    id: parent.id,
    day: "2026-11-04",
    subtasks: { total: 2, done: 0, next: "B" },
  });
  expect(got.subtasks.map((s) => s.title)).toEqual(["B", "A"]);
  expect(got.parents).toEqual([]);
  const child = await caller.tasks.get({ id: a.id });
  expect(child.parents.map((p) => p.id)).toEqual([parent.id]);
  await close();
});

test("dueBetween uses its indexes", async () => {
  const { deps, close } = await setup();
  await deps.db.execute(sql`
    with made as (
      insert into items (type, title)
      select 'task', 'Task ' || n from generate_series(1, 10000) n
      returning id, title
    )
    insert into tasks (item_id, due_date, due_at, completed_at, sort_key)
    select id,
      case when n % 2 = 0 then date '2026-01-01' + (n / 2 % 700) end,
      case when n % 2 = 1 then timestamptz '2026-01-01 12:00Z' + (n / 2 % 700) * interval '1 day' end,
      case when n % 5 = 0 then timestamptz '2026-01-01 00:00Z' end,
      'a' || lpad(n::text, 6, '0')
    from (select id, substring(title from 6)::int as n from made) m`);
  await deps.db.execute(sql`analyze tasks`);
  await deps.db.execute(sql`analyze items`);

  const args = {
    from: "2026-11-06",
    to: "2026-11-07",
    timeZone: LA,
    include: "open" as const,
  };
  const plan = await deps.db.execute<{ "QUERY PLAN": string }>(
    sql`explain ${dueBetweenQuery(args)}`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  expect(text).toContain("tasks_due_date_open_idx");
  expect(text).toContain("tasks_due_at_open_idx");
  expect((await dueBetween(deps.db, args)).length).toBeGreaterThan(0);
  await close();
});
