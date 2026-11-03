import { freshModuleDb } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import { requests } from "../src/db/schema";
import requestsServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const newItem = async () => {
    const rows = await t.db.execute<{ id: string }>(
      sql`insert into items (type, title) values ('request', 'A request') returning id`,
    );
    return rows[0].id;
  };
  return { ...t, newItem };
}

test("the migration applies after Core and Tasks", async () => {
  const { db, newItem, close } = await setup();
  await db
    .insert(requests)
    .values({ itemId: await newItem(), source: "manual" });
  const [row] = await db.select().from(requests);
  expect(row.resolvedAt).toBeNull();
  expect(row.receivedAt).toBeInstanceOf(Date);
  await close();
});

test("outcome without resolved_at is refused", async () => {
  const { db, newItem, close } = await setup();
  await expect(
    db.insert(requests).values({
      itemId: await newItem(),
      source: "manual",
      outcome: "handled",
    }),
  ).rejects.toThrow();
  await expect(
    db.insert(requests).values({
      itemId: await newItem(),
      source: "manual",
      resolvedAt: new Date(),
    }),
  ).rejects.toThrow();
  await close();
});

test("external_id with manual is refused", async () => {
  const { db, newItem, close } = await setup();
  await expect(
    db
      .insert(requests)
      .values({ itemId: await newItem(), source: "manual", externalId: "x" }),
  ).rejects.toThrow();
  await close();
});

test("a second (slack, X) row is refused but (agent, X) is allowed", async () => {
  const { db, newItem, close } = await setup();
  await db
    .insert(requests)
    .values({ itemId: await newItem(), source: "slack", externalId: "X" });
  await expect(
    db
      .insert(requests)
      .values({ itemId: await newItem(), source: "slack", externalId: "X" }),
  ).rejects.toThrow();
  await db
    .insert(requests)
    .values({ itemId: await newItem(), source: "agent", externalId: "X" });
  await close();
});

test("deleting the item cascades the row", async () => {
  const { db, newItem, close } = await setup();
  const id = await newItem();
  await db.insert(requests).values({ itemId: id, source: "manual" });
  await db.execute(sql`delete from items where id = ${id}`);
  expect((await db.execute(sql`select 1 from requests`)).length).toBe(0);
  await close();
});
