import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Text that sorts by byte: fractional-indexing keys must not be ordered by the
 * database's locale collation.
 */
const byteText = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
});

/**
 * One row per task item. `item_id` references Core's `items(id) on delete cascade`;
 * that foreign key is written by hand in the migration SQL, since this module
 * never imports Core's tables.
 */
// The `items` FK lives only in the hand-edited SQL: drizzle's snapshot has none.
export const tasks = pgTable(
  "tasks",
  {
    itemId: uuid("item_id").primaryKey(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3,
    }),
    dueDate: date("due_date"),
    dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }),
    dueTz: text("due_tz"),
    priority: text("priority").notNull().default("medium"),
    notes: text("notes"),
    sortKey: byteText("sort_key").notNull(),
    assignee: text("assignee").notNull().default("me"),
  },
  (t) => [
    check("tasks_priority_check", sql`${t.priority} in ('medium', 'high')`),
    check("tasks_assignee_check", sql`${t.assignee} in ('me', 'agent')`),
    check(
      "tasks_due_exclusive_check",
      sql`${t.dueDate} is null or ${t.dueAt} is null`,
    ),
    check(
      "tasks_due_tz_check",
      sql`${t.dueTz} is null or ${t.dueAt} is not null`,
    ),
    index("tasks_due_date_open_idx")
      .on(t.dueDate)
      .where(sql`${t.completedAt} is null`),
    index("tasks_due_at_open_idx")
      .on(t.dueAt)
      .where(sql`${t.completedAt} is null`),
    index("tasks_completed_idx")
      .on(t.completedAt.desc())
      .where(sql`${t.completedAt} is not null`),
  ],
);
