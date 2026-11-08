import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { setup } from "./setup";

/** A database with a few approved outbox rows, `ago` hours old, in the order given. */
async function harness(rows: { key: string; ago: number }[]) {
  const s = await setup();
  for (const r of rows) {
    await s.db.execute(
      sql`insert into slack_outbox (key, origin, channel_id, thread_ts, text, status, approved_at)
          values (${r.key}, 'report', 'C1', '1.1', ${`text ${r.key}`}, 'approved', now() - make_interval(hours => ${r.ago}))`,
    );
  }
  const row = async (key: string) =>
    (
      await s.db.execute<{
        id: string;
        status: string;
        error: string | null;
        sent_ts: string | null;
        sent_at: Date | null;
      }>(
        sql`select id, status, error, sent_ts, sent_at from slack_outbox where key = ${key}`,
      )
    )[0];
  return { ...s, row };
}

test("pendingSends returns approved rows oldest first and records seen_at", async () => {
  const h = await harness([
    { key: "b", ago: 2 },
    { key: "a", ago: 5 },
    { key: "c", ago: 1 },
  ]);
  expect((await h.caller.slack.settings({})).seenAt).toBeNull();
  const { result } = await h.slack.slack.pendingSends({});
  expect(result).toEqual([
    {
      id: (await h.row("a"))?.id,
      channelId: "C1",
      threadTs: "1.1",
      text: "text a",
    },
    {
      id: (await h.row("b"))?.id,
      channelId: "C1",
      threadTs: "1.1",
      text: "text b",
    },
    {
      id: (await h.row("c"))?.id,
      channelId: "C1",
      threadTs: "1.1",
      text: "text c",
    },
  ]);
  expect((await h.caller.slack.settings({})).seenAt).not.toBeNull();
  await h.close();
});

test("pendingSends returns at most 20 rows", async () => {
  const h = await harness(
    Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, ago: 1 })),
  );
  expect((await h.slack.slack.pendingSends({})).result).toHaveLength(20);
  await h.close();
});

test("old approved rows fail as Too old to send", async () => {
  const h = await harness([
    { key: "old", ago: 25 },
    { key: "new", ago: 1 },
  ]);
  const { result } = await h.slack.slack.pendingSends({});
  expect(result.map((r) => r.text)).toEqual(["text new"]);
  expect(await h.row("old")).toMatchObject({
    status: "failed",
    error: "Too old to send",
  });
  await h.close();
});

test("markSent twice is a no-op", async () => {
  const h = await harness([{ key: "a", ago: 1 }]);
  const id = (await h.row("a"))?.id as string;
  await h.slack.slack.markSent({ id, ts: "9.9" });
  const first = await h.row("a");
  expect(first).toMatchObject({ status: "sent", sent_ts: "9.9" });
  expect(first?.sent_at).not.toBeNull();
  await h.slack.slack.markSent({ id, ts: "8.8" });
  await h.slack.slack.markFailed({ id, error: "late" });
  expect(await h.row("a")).toEqual(first);
  await h.close();
});

test("markFailed records the error", async () => {
  const h = await harness([{ key: "a", ago: 1 }]);
  const id = (await h.row("a"))?.id as string;
  await h.slack.slack.markFailed({ id, error: "channel_not_found" });
  expect(await h.row("a")).toMatchObject({
    status: "failed",
    error: "channel_not_found",
  });
  expect((await h.slack.slack.pendingSends({})).result).toEqual([]);
  await h.close();
});

test("only a slack token calls the outbox", async () => {
  const h = await harness([]);
  await expect(h.caller.slack.pendingSends({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await h.close();
});

test("an insert without approved_at gets one and is still subject to the 24 h rule", async () => {
  const h = await harness([]);
  await h.db.execute(
    sql`insert into slack_outbox (key, origin, channel_id, text, created_at)
        values ('d', 'report', 'C1', 'x', now() - interval '2 days')`,
  );
  const [r] = await h.db.execute<{ approved_at: Date | null }>(
    sql`select approved_at from slack_outbox where key = 'd'`,
  );
  expect(r?.approved_at).not.toBeNull();
  // The default is the insert time, so a fresh row is sent...
  expect((await h.slack.slack.pendingSends({})).result).toHaveLength(1);
  // ...and once 25 hours old, it fails like any other.
  await h.db.execute(
    sql`update slack_outbox set approved_at = now() - interval '25 hours' where key = 'd'`,
  );
  expect((await h.slack.slack.pendingSends({})).result).toEqual([]);
  expect((await h.row("d"))?.status).toBe("failed");
  await h.close();
});
