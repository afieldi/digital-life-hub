import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  deviceName: text("device_name").notNull(),
  platform: text("platform").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const loginAttempts = pgTable("login_attempts", {
  state: text("state").primaryKey(),
  codeVerifier: text("code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    type: text("type").notNull(),
    title: text("title").notNull(),
    searchText: text("search_text"),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(search_text, '')), 'B')`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 3 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    index("items_search_idx").using("gin", t.search),
    index("items_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("items_type_updated_idx")
      .on(t.type, t.updatedAt.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    fromId: uuid("from_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("links_from_to_kind_uq").on(t.fromId, t.toId, t.kind),
    index("links_to_idx").on(t.toId),
    check("links_no_self", sql`${t.fromId} <> ${t.toId}`),
  ],
);

export const itemViews = pgTable(
  "item_views",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", {
      withTimezone: true,
      precision: 3,
    }).notNull(),
  },
  (t) => [
    index("item_views_viewed_idx").on(t.viewedAt.desc()),
    index("item_views_item_idx").on(t.itemId, t.viewedAt.desc()),
  ],
);

export const aiRequests = pgTable(
  "ai_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, precision: 3 }),
    actionId: text("action_id").notNull(),
    kind: text("kind").notNull(),
    interpretedBy: text("interpreted_by"),
    provider: text("provider").notNull(),
    model: text("model"),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    itemVersion: timestamp("item_version", {
      withTimezone: true,
      precision: 3,
    }),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd"),
    output: jsonb("output"),
    undo: jsonb("undo"),
  },
  (t) => [index("ai_requests_created_idx").on(t.createdAt.desc())],
);

export const aiSettings = pgTable(
  "ai_settings",
  {
    id: integer("id").primaryKey().default(1),
    defaultProvider: text("default_provider").notNull(),
    openrouterModel: text("openrouter_model"),
    interpreter: text("interpreter").notNull().default("keywords"),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("ai_settings_single_row", sql`${t.id} = 1`)],
);
