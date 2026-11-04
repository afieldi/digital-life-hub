import { freshModuleDb } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import {
  agentAssignments,
  agentRunEvents,
  agentRunMessages,
  agentRuns,
  agentSettings,
} from "../src/db/schema";
import agentServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([tasksServer, agentServer]);
  const newItem = async () => {
    const rows = await t.db.execute<{ id: string }>(
      sql`insert into items (type, title) values ('task', 'A task') returning id`,
    );
    return rows[0].id;
  };
  return { ...t, newItem };
}

test("a second active run for one task is refused", async () => {
  const { db, newItem, close } = await setup();
  const taskId = await newItem();
  await db.insert(agentRuns).values({ taskId, status: "queued" });
  await expect(
    db.insert(agentRuns).values({ taskId, status: "running" }),
  ).rejects.toThrow();
  await db
    .update(agentRuns)
    .set({ status: "done" })
    .where(eq(agentRuns.taskId, taskId));
  await db.insert(agentRuns).values({ taskId, status: "queued" });
  await close();
});

test("deleting the task item removes its runs, events and messages", async () => {
  const { db, newItem, close } = await setup();
  const taskId = await newItem();
  const [run] = await db
    .insert(agentRuns)
    .values({ taskId, status: "running" })
    .returning();
  await db
    .insert(agentRunEvents)
    .values({ runId: run.id, seq: 1, kind: "text", data: { text: "hi" } });
  await db.insert(agentRunMessages).values({ runId: run.id, body: "go" });
  await db.execute(sql`delete from items where id = ${taskId}`);
  expect(await db.select().from(agentRuns)).toHaveLength(0);
  expect(await db.select().from(agentRunEvents)).toHaveLength(0);
  expect(await db.select().from(agentRunMessages)).toHaveLength(0);
  await close();
});

test("settings has one row with the defaults", async () => {
  const { db, close } = await setup();
  const rows = await db.select().from(agentSettings);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: 1,
    defaultConnectionIds: [],
    maxParallel: 3,
    maxRunningMinutes: 240,
    maxCostUsd: "10.00",
    instructions: "",
    timeZone: "UTC",
  });
  await expect(db.insert(agentSettings).values({ id: 2 })).rejects.toThrow();
  await close();
});

test("deleting the request item nulls the assignment's request_id", async () => {
  const { db, newItem, close } = await setup();
  const taskId = await newItem();
  const requestId = await newItem();
  await db.insert(agentAssignments).values({ taskId, requestId });
  await db.execute(sql`delete from items where id = ${requestId}`);
  const [row] = await db.select().from(agentAssignments);
  expect(row.taskId).toBe(taskId);
  expect(row.requestId).toBeNull();
  await close();
});
