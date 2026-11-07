import { freshModuleDb } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import slackServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([slackServer]);
  const item = async () =>
    (
      await t.db.execute<{ id: string }>(
        sql`insert into items (type, title) values ('request', 'R') returning id`,
      )
    )[0].id;
  return { ...t, item };
}

const insert = (
  db: Awaited<ReturnType<typeof setup>>["db"],
  v: { key: string; origin: string; status?: string; requestId?: string },
) =>
  db.execute(
    sql`insert into slack_outbox (key, origin, channel_id, text, request_id, status)
        values (${v.key}, ${v.origin}, 'C1', 'hi', ${v.requestId ?? null}, ${v.status ?? "approved"})`,
  );

test("the outbox refuses a draft origin", async () => {
  const { db, close } = await setup();
  await expect(
    insert(db, { key: "draft:1", origin: "draft" }),
  ).rejects.toThrow();
  await expect(
    insert(db, { key: "r:1", origin: "report", status: "pending" }),
  ).rejects.toThrow();
  await insert(db, { key: "report:2", origin: "report" });
  await db.execute(sql`select "as" from slack_outbox`).then(
    () => {
      throw new Error("the as column should be gone");
    },
    () => undefined,
  );
  await close();
});

test("an outbox key is unique", async () => {
  const { db, close } = await setup();
  await insert(db, { key: "k", origin: "agent" });
  await expect(insert(db, { key: "k", origin: "agent" })).rejects.toThrow();
  await close();
});

test("deleting the request removes its outbox rows", async () => {
  const { db, item, close } = await setup();
  const requestId = await item();
  await insert(db, { key: "agent:r", origin: "agent", requestId });
  await db.execute(sql`delete from items where id = ${requestId}`);
  expect(await db.execute(sql`select 1 from slack_outbox`)).toHaveLength(0);
  await close();
});

test("settings has one row", async () => {
  const { db, close } = await setup();
  expect(await db.execute(sql`select 1 from slack_settings`)).toHaveLength(1);
  await expect(
    db.execute(sql`insert into slack_settings (id) values (2)`),
  ).rejects.toThrow();
  await close();
});
