import { sql } from "drizzle-orm";
import { searchItems } from "../src/items/search";
import { freshTestDb } from "../src/testing";

test("p95 search latency is under 50 ms over 10,000 items", async () => {
  const { db, close } = await freshTestDb();
  await db.execute(sql`
    create temp table words as
      select i, translate(substr(md5(i::text), 1, 4 + i % 6), '0123456789', 'ghijklmnop') as w from generate_series(1, 200) i`);
  await db.execute(sql`
    insert into items (type, title, search_text, created_at, updated_at)
    select 'test',
      (select string_agg(w, ' ') from words where i = 1 + (g * 7) % 200 or i = 1 + (g * 13 + 5) % 200),
      (select string_agg(w, ' ') from words where i = any (
         array(select 1 + (g * k) % 200 from generate_series(1, 20) k))),
      '2026-10-30T12:00:00Z'::timestamptz - (g || ' seconds')::interval,
      '2026-10-30T12:00:00Z'::timestamptz - (g || ' seconds')::interval
    from generate_series(1, 10000) g`);
  await db.execute(sql`analyze items`);
  const words = (
    await db.execute<{ w: string }>(sql`select w from words order by i`)
  ).map((r) => r.w);
  const queries = [
    ...[0, 17, 44, 99, 150, 199].map((i) => words[i]),
    ...[3, 60, 120, 180].map((i) => `${words[i]} ${words[i + 1]}`),
    ...[5, 40, 90, 160].map((i) => words[i].slice(0, 6) + words[i].slice(7)),
    ...[7, 77, 177].map((i) => words[i].slice(0, 3)),
    ..."abcdefgh".split(""),
    ...[8, 88, 188, 28, 128].map((i) => `${words[i]} ${words[i + 3]}`),
  ].slice(0, 30);
  expect(queries).toHaveLength(30);
  await searchItems(db, { query: queries[0] }); // warm connection
  const times: number[] = [];
  for (const query of queries) {
    const t = performance.now();
    await searchItems(db, { query });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  console.log(
    `search p95 = ${p95.toFixed(1)} ms (max ${times.at(-1)?.toFixed(1)})`,
  );
  expect(p95).toBeLessThan(50);
  await close();
}, 120_000);
