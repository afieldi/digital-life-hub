import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DEFAULT_INTERPRETER } from "../schema";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 });

/** The one settings row, which the migration inserts. */
export const slackSettings = pgTable(
  "slack_settings",
  {
    id: integer("id").primaryKey().default(1),
    teamId: text("team_id"),
    botUserId: text("bot_user_id"),
    ownerSlackId: text("owner_slack_id"),
    ackText: text("ack_text")
      .notNull()
      .default("Got it, I've passed this to Arek."),
    threshold: doublePrecision("threshold").notNull().default(0.6),
    appendMinutes: integer("append_minutes").notNull().default(15),
    interpreter: text("interpreter").notNull().default(DEFAULT_INTERPRETER),
    coworkerAi: boolean("coworker_ai").notNull().default(true),
    /** When `slack.syncRuns` last looked at ended runs. */
    runsSyncedAt: at("runs_synced_at"),
    /** When the bot last heard from you; null until it first does. */
    seenAt: at("seen_at"),
  },
  (t) => [
    check("slack_settings_single_row_check", sql`${t.id} = 1`),
    check(
      "slack_settings_threshold_check",
      sql`${t.threshold} between 0 and 1`,
    ),
    check(
      "slack_settings_append_minutes_check",
      sql`${t.appendMinutes} between 1 and 120`,
    ),
  ],
);

export const slackPeople = pgTable(
  "slack_people",
  {
    slackUserId: text("slack_user_id").primaryKey(),
    name: text("name").notNull(),
    githubLogin: text("github_login"),
    githubFrom: text("github_from").notNull().default("profile"),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "slack_people_github_from_check",
      sql`${t.githubFrom} in ('profile', 'manual')`,
    ),
  ],
);

/**
 * Messages for `apps/slack` to send. `request_id → items(id) on delete cascade`
 * is written by hand in the migration SQL, since this module never imports
 * Core's tables.
 */
export const slackOutbox = pgTable(
  "slack_outbox",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    /** Makes every insert idempotent: `report:<runId>`, `draft:<requestId>`… */
    key: text("key").notNull(),
    origin: text("origin").notNull(),
    as: text("as").notNull(),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts"),
    text: text("text").notNull(),
    status: text("status").notNull().default("pending"),
    requestId: uuid("request_id"),
    runId: uuid("run_id"),
    error: text("error"),
    sentTs: text("sent_ts"),
    createdAt: at("created_at").notNull().defaultNow(),
    approvedAt: at("approved_at"),
    sentAt: at("sent_at"),
  },
  (t) => [
    uniqueIndex("slack_outbox_key_idx").on(t.key),
    index("slack_outbox_status_idx").on(t.status),
    check(
      "slack_outbox_origin_check",
      sql`${t.origin} in ('draft', 'agent', 'report', 'review_ping', 'escalation')`,
    ),
    check("slack_outbox_as_check", sql`${t.as} in ('bot', 'me')`),
    check(
      "slack_outbox_status_check",
      sql`${t.status} in ('pending', 'approved', 'sent', 'failed', 'discarded')`,
    ),
    check(
      "slack_outbox_as_me_draft_check",
      sql`${t.as} = 'bot' or ${t.origin} = 'draft'`,
    ),
  ],
);

/**
 * Undo for operations the bot runs outside the gateway. A button names a row
 * here, never a raw token; `used_at` makes Undo single use. Nothing keys a row
 * to an item.
 */
export const slackActions = pgTable("slack_actions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  operation: text("operation").notNull(),
  token: jsonb("token").notNull(),
  /** The task whose run a handoff started. */
  runTaskId: uuid("run_task_id"),
  createdAt: at("created_at").notNull().defaultNow(),
  usedAt: at("used_at"),
});
