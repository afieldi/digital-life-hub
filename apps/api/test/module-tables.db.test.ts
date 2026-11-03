import { sql } from "drizzle-orm";
import { freshModuleDb, serverModules } from "../src/testing";

// The purge hard-deletes items, so every row that points at one must go with
// it (or let go of it): a plain foreign key would fail the purge every day,
// and a missing one would leave orphan rows. Module tables get their foreign
// key only from hand-edited migration SQL, so this checks the migrated schema.

test("every foreign key to items cascades or sets null", async () => {
  const t = await freshModuleDb(serverModules);
  try {
    const rows = await t.db.execute<{ table: string; rule: string }>(sql`
      select tc.table_name as "table", rc.delete_rule as rule
      from information_schema.referential_constraints rc
      join information_schema.table_constraints tc
        on tc.constraint_name = rc.constraint_name
      join information_schema.constraint_column_usage cu
        on cu.constraint_name = rc.unique_constraint_name
      where cu.table_name = 'items' and cu.column_name = 'id'
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["CASCADE", "SET NULL"], r.table).toContain(r.rule);
    }
  } finally {
    await t.close();
  }
});

test("every item_id column has a foreign key to items", async () => {
  const t = await freshModuleDb(serverModules);
  try {
    const missing = await t.db.execute<{ table: string }>(sql`
      select c.table_name as "table"
      from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'item_id'
        and not exists (
          select 1
          from information_schema.key_column_usage k
          join information_schema.referential_constraints rc
            on rc.constraint_name = k.constraint_name
          join information_schema.constraint_column_usage cu
            on cu.constraint_name = rc.unique_constraint_name
          where k.table_name = c.table_name and k.column_name = 'item_id'
            and cu.table_name = 'items'
        )
    `);
    expect(missing.map((r) => r.table)).toEqual([]);
  } finally {
    await t.close();
  }
});
