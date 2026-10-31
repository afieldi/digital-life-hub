import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
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
