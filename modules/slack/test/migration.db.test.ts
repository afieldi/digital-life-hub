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
  v: { key: string; origin: string; as: string; requestId?: string },
) =>
  db.execute(
    sql`insert into slack_outbox (key, origin, "as", channel_id, text, request_id)
        values (${v.key}, ${v.origin}, ${v.as}, 'C1', 'hi', ${v.requestId ?? null})`,
  );

test("the outbox refuses as me for a non-draft row", async () => {
  const { db, close } = await setup();
  await expect(
    insert(db, { key: "report:1", origin: "report", as: "me" }),
  ).rejects.toThrow();
  await insert(db, { key: "draft:1", origin: "draft", as: "me" });
  await insert(db, { key: "report:2", origin: "report", as: "bot" });
  await close();
});

test("an outbox key is unique", async () => {
  const { db, close } = await setup();
  await insert(db, { key: "k", origin: "agent", as: "bot" });
  await expect(
    insert(db, { key: "k", origin: "agent", as: "bot" }),
  ).rejects.toThrow();
  await close();
});

test("deleting the request removes its outbox rows", async () => {
  const { db, item, close } = await setup();
  const requestId = await item();
  await insert(db, { key: "draft:r", origin: "draft", as: "me", requestId });
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
