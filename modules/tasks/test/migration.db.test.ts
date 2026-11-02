import { freshModuleDb } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { tasks } from "../src/db/schema";
import tasksServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([tasksServer]);
  const rows = await t.db.execute<{ id: string }>(
    sql`insert into items (type, title) values ('task', 'A task') returning id`,
  );
  return { ...t, id: rows[0].id };
}

test("the migration creates tasks", async () => {
  const { db, id, close } = await setup();
  await db.insert(tasks).values({ itemId: id, sortKey: "a0" });
  const [row] = await db.select().from(tasks);
  expect(row.priority).toBe("medium");
  await close();
});

test("due_date and due_at together violate the check", async () => {
  const { db, id, close } = await setup();
  await expect(
    db.insert(tasks).values({
      itemId: id,
      sortKey: "a0",
      dueDate: "2026-11-06",
      dueAt: new Date("2026-11-06T17:00:00Z"),
    }),
  ).rejects.toThrow();
  await close();
});

test("due_tz without due_at violates the check", async () => {
  const { db, id, close } = await setup();
  await expect(
    db.insert(tasks).values({
      itemId: id,
      sortKey: "a0",
      dueDate: "2026-11-06",
      dueTz: "America/Los_Angeles",
    }),
  ).rejects.toThrow();
  await close();
});

test("an unknown priority violates the check", async () => {
  const { db, id, close } = await setup();
  await expect(
    db.insert(tasks).values({ itemId: id, sortKey: "a0", priority: "low" }),
  ).rejects.toThrow();
  await close();
});

test("deleting the item removes the task row", async () => {
  const { db, id, close } = await setup();
  await db.insert(tasks).values({ itemId: id, sortKey: "a0" });
  await db.execute(sql`delete from items where id = ${id}`);
  const rows = await db.execute(sql`select 1 from tasks`);
  expect(rows.length).toBe(0);
  await close();
});

test("sort_key sorts by byte (collation C)", async () => {
  const { db, close } = await setup();
  const rows = await db.execute<{ collation_name: string }>(sql`
    select collation_name from information_schema.columns
    where table_name = 'tasks' and column_name = 'sort_key'`);
  expect(rows[0]?.collation_name).toBe("C");
  await close();
});
