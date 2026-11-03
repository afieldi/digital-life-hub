import { prepare, runMutation, undo } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import { requests } from "../src/db/schema";
import requestsServer from "../src/server";

/** Tasks and Requests registered, with Core's AI actions, through the gateway's fake provider. */
async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const { deps, operations } = testServer(t.db, [requestsServer, tasksServer], {
    itemTypes: ["note"],
  });
  const fileOp = operations.get("requests.file");
  if (fileOp?.kind !== "mutation") throw new Error("no requests.file");
  const file = async (title: string, body?: string) =>
    (
      (await runMutation(deps, fileOp, { title, body, source: "manual" }))
        .result as { request: { id: string; updatedAt: string } }
    ).request;
  /** Moves the frozen clock on, so a later write gets a later version. */
  const tick = () => deps.setNow(new Date(deps.now().getTime() + 1000));
  return { ...t, deps, file, tick };
}

type Deps = Awaited<ReturnType<typeof setup>>["deps"];

async function requestRow(deps: Deps, id: string) {
  const [row] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, id));
  if (!row) throw new Error(`no request row ${id}`);
  return row;
}

async function isDeleted(deps: Deps, id: string): Promise<boolean> {
  const [row] = await deps.db.execute<{ deleted: boolean }>(
    sql`select deleted_at is not null as deleted from items where id = ${id}`,
  );
  if (!row) throw new Error(`no item ${id}`);
  return row.deleted;
}

/** Live tasks with their notes, by title. */
async function liveTasks(deps: Deps) {
  const rows = await deps.db.execute<{
    id: string;
    title: string;
    notes: string | null;
  }>(sql`
    select i.id, i.title, t.notes from items i join tasks t on t.item_id = i.id
    where i.deleted_at is null order by i.title`);
  return [...rows];
}

test("file through AI files with source ai, and Undo deletes it", async () => {
  const s = await setup();
  s.deps.fakeProvider.queue(JSON.stringify({ title: "Look at the contract" }));
  const res = await prepare(s.deps, {
    text: "remind me to look at the contract",
    actionId: "requests.file",
    kind: "do",
  });
  expect(res).toMatchObject({
    status: "applied",
    summary: "File a request: Look at the contract",
  });
  const all = await s.deps.db.select().from(requests);
  expect(all).toHaveLength(1);
  const row = all[0];
  if (!row) throw new Error("not filed");
  expect(row.source).toBe("ai");
  expect(row.outcome).toBeNull();

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await isDeleted(s.deps, row.itemId)).toBe(true);
  await s.close();
});

test("make a task from this creates the task, and Undo removes it and reopens", async () => {
  const s = await setup();
  const r = await s.file("Review the Q3 deck", "Slides 4-9");
  s.tick();
  s.deps.fakeProvider.queue(JSON.stringify({}));
  const res = await prepare(s.deps, {
    text: "make a task from this",
    itemId: r.id,
    actionId: "requests.makeTask",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied", summary: "Make task" });
  const tasks = await liveTasks(s.deps);
  expect(tasks).toMatchObject([
    { title: "Review the Q3 deck", notes: "Slides 4-9" },
  ]);
  expect((await requestRow(s.deps, r.id)).outcome).toBe("task");

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect(await liveTasks(s.deps)).toEqual([]);
  const row = await requestRow(s.deps, r.id);
  expect(row.outcome).toBeNull();
  expect(row.resolvedAt).toBeNull();
  await s.close();
});

test("not for me resolves the request on screen", async () => {
  const s = await setup();
  const r = await s.file("Sign up for the offsite");
  s.tick();
  s.deps.fakeProvider.queue(JSON.stringify({ outcome: "not_for_me" }));
  const res = await prepare(s.deps, {
    text: "not for me",
    itemId: r.id,
    actionId: "requests.resolve",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied", summary: "Not for me" });
  const row = await requestRow(s.deps, r.id);
  expect(row.outcome).toBe("not_for_me");
  expect(row.resolvedAt).not.toBeNull();
  // The model was given the request on screen.
  expect(s.deps.fakeProvider.calls[0]?.prompt ?? "").toContain(
    "Sign up for the offsite",
  );
  await s.close();
});

test("what's waiting on me lists open requests", async () => {
  const s = await setup();
  const older = await s.file("Review the Q3 deck");
  s.tick();
  const newer = await s.file("Approve Dana's expenses");
  s.tick();
  const done = await s.file("Sign up for the offsite");
  s.tick();
  s.deps.fakeProvider.queue(JSON.stringify({ outcome: "handled" }));
  await prepare(s.deps, {
    text: "handled",
    itemId: done.id,
    actionId: "requests.resolve",
    kind: "do",
  });

  s.deps.fakeProvider.queue(JSON.stringify({}));
  const res = await prepare(s.deps, {
    text: "what's waiting on me?",
    actionId: "requests.open",
    kind: "ask",
  });
  expect(res).toMatchObject({
    status: "listed",
    items: [
      { id: older.id, type: "request", title: "Review the Q3 deck" },
      { id: newer.id, type: "request", title: "Approve Dana's expenses" },
    ],
  });
  if (res.status !== "listed") throw new Error();
  expect(res.items).toHaveLength(2);
  await s.close();
});
