import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per request item. `item_id` references Core's `items(id) on delete cascade`;
 * that foreign key is written by hand in the migration SQL, since this module
 * never imports Core's tables.
 */
// The `items` FK lives only in the hand-edited SQL: drizzle's snapshot has none.
export const requests = pgTable(
  "requests",
  {
    itemId: uuid("item_id").primaryKey(),
    body: text("body"),
    fromName: text("from_name"),
    fromOwner: boolean("from_owner").notNull().default(false),
    source: text("source").notNull(),
    sourceHandle: text("source_handle"),
    sourceUrl: text("source_url"),
    externalId: text("external_id"),
    receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    actions: jsonb("actions"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, precision: 3 }),
    outcome: text("outcome"),
    /** Keys of the messages `append` added, so a redelivered one is not added twice. */
    appendedIds: text("appended_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    check(
      "requests_source_check",
      sql`${t.source} in ('manual', 'ai', 'slack', 'agent')`,
    ),
    check(
      "requests_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('task', 'handled', 'not_for_me')`,
    ),
    check(
      "requests_resolved_pair_check",
      sql`(${t.outcome} is null) = (${t.resolvedAt} is null)`,
    ),
    check(
      "requests_manual_external_check",
      sql`${t.source} <> 'manual' or ${t.externalId} is null`,
    ),
    uniqueIndex("requests_source_external_idx")
      .on(t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("requests_open_idx")
      .on(t.receivedAt)
      .where(sql`${t.resolvedAt} is null`),
    index("requests_resolved_idx")
      .on(t.resolvedAt.desc())
      .where(sql`${t.resolvedAt} is not null`),
  ],
);
