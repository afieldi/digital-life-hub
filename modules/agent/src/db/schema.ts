import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Audience,
  Decision,
  HubApproval,
  Pending,
  Report,
} from "../schema";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 });

/**
 * The connections a task starts with. `task_id` references Core's
 * `items(id) on delete cascade`; that foreign key is written by hand in the
 * migration SQL, since this module never imports Core's tables.
 */
export const agentAssignments = pgTable("agent_assignments", {
  taskId: uuid("task_id").primaryKey(),
  connectionIds: uuid("connection_ids").array().notNull().default(sql`'{}'`),
  /** The request the task was given from (set by `assignRequest`). */
  requestId: uuid("request_id"),
});

/** One row per run of an agent on a task. `task_id → items(id)` is by hand in the SQL. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id").notNull(),
    status: text("status").notNull(),
    sessionId: text("session_id"),
    workspace: text("workspace"),
    connectionIds: uuid("connection_ids").array().notNull().default(sql`'{}'`),
    pending: jsonb("pending").$type<Pending>(),
    decision: jsonb("decision").$type<Decision>(),
    failures: integer("failures").notNull().default(0),
    heartbeatAt: at("heartbeat_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    startedAt: at("started_at"),
    finishedAt: at("finished_at"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    report: jsonb("report").$type<Report>(),
    turns: integer("turns").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    /** `cost_usd` when the current allowance began (the last Retry); the cost cap counts from it. */
    costBaseUsd: numeric("cost_base_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    /** Running time in the current allowance, added by each heartbeat; the time cap counts it. */
    runningMs: integer("running_ms").notNull().default(0),
    image: text("image"),
    /** Whom the run answers to when it isn't you: a coworker's request (`runGuard`). */
    audience: jsonb("audience").$type<Audience>(),
    /** Hub calls you approved for the run, each passing its guard once. */
    hubApprovals: jsonb("hub_approvals")
      .$type<HubApproval[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    check(
      "agent_runs_status_check",
      sql`${t.status} in ('queued', 'running', 'waiting', 'done', 'failed', 'cancelled')`,
    ),
    uniqueIndex("agent_runs_active_task_idx")
      .on(t.taskId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting')`),
    index("agent_runs_queued_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'queued'`),
  ],
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    at: at("at").notNull().defaultNow(),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    check(
      "agent_run_events_kind_check",
      sql`${t.kind} in ('text', 'tool', 'tool_result', 'file', 'permission', 'status')`,
    ),
  ],
);

export const agentRunMessages = pgTable(
  "agent_run_messages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    at: at("at").notNull().defaultNow(),
    body: text("body").notNull(),
    deliveredAt: at("delivered_at"),
  },
  (t) => [index("agent_run_messages_run_idx").on(t.runId)],
);

/** Metadata only: what a connection is, never its secret. */
export const agentConnections = pgTable(
  "agent_connections",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull().unique(),
    type: text("type").notNull(),
    scopeSummary: text("scope_summary").notNull().default(""),
    createdAt: at("created_at").notNull().defaultNow(),
    disabledAt: at("disabled_at"),
  },
  (t) => [
    check(
      "agent_connections_type_check",
      sql`${t.type} in ('github', 'aws', 'slack', 'linear', 'gdrive', 'mcp', 'env')`,
    ),
  ],
);

/** A single row (`id = 1`), inserted by the migration. */
export const agentSettings = pgTable(
  "agent_settings",
  {
    id: integer("id").primaryKey().default(1),
    defaultConnectionIds: uuid("default_connection_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The connections a run for a coworker's request starts with. */
    coworkerConnectionIds: uuid("coworker_connection_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    maxParallel: integer("max_parallel").notNull().default(3),
    maxRunningMinutes: integer("max_running_minutes").notNull().default(240),
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 2 })
      .notNull()
      .default("10"),
    instructions: text("instructions").notNull().default(""),
    timeZone: text("time_zone").notNull().default("UTC"),
    /** When the host's worker last claimed; the screen shows whether it is up. */
    workerSeenAt: at("worker_seen_at"),
  },
  (t) => [check("agent_settings_single_row_check", sql`${t.id} = 1`)],
);
