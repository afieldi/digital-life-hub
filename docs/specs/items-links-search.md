# Items, Links, Search — Deep-dive Spec

Oct 30, 2026 · Arek

## Scope

Milestone 3 of [Core + Shell](core-and-shell.md): the shared data layer every module plugs into. When it is done, a module can create items, link them, have them found in ⌘K and see edits from another device, without Core knowing anything about that module. Tasks is built next, on top of it.

**In scope**

- `items`, `links` and `item_views` tables, with full-text and trigram search
- A server-side module contract, so modules register item types and their own tRPC routers
- One write path for items that handles conflicts, `updated_at` and change events
- Core routers: `items`, `links`, `search`, `recents`
- The `/changes` stream and live refresh in the desktop app
- ⌘K Recents and Jump to
- The sample module extended to create, list, open and rename items, and to seed the dev database

**Out of scope**

- Module-owned tables and migrations (designed with Tasks, the first module that needs one)
- `tagged` links and tag items
- Home's Jump back in (comes with the Home module)
- AI gateway (milestone 4)

**Done when** a test module creates 10,000 items, search returns under 50 ms, and an edit made through a test script against the local API shows in the open app within 2 seconds.

## Packages

A module's server code needs Core's item functions and the tRPC setup, and the API imports every module's server code. To keep that one-directional, server-side Core gets its own package.

```
packages/core     + item and link schemas (Zod), useRecordView hook
packages/db       + items, links, item_views tables; pg_trgm migration
packages/server   NEW @dlh/server: tRPC setup (moved from apps/api), item/link/search/recents
                  functions, change bus, defineServerModule, core routers, testing helpers
modules/sample    + src/server.ts: item type "sample", sample.create router
apps/api          imports module server entries, checks them, mounts their routers, serves /changes
apps/desktop      ⌘K Recents and Jump to, view recording, /changes listener
```

Dependencies point one way: `apps/api` → `modules/*` → `@dlh/server` → `@dlh/db`. `@dlh/core` stays free of server code because the desktop imports it.

## Server module contract

Each module may add a React-free `src/server.ts` next to its manifest.

```ts
export default defineServerModule({
  id: "sample",                 // must match the manifest id
  itemTypes: ["sample"],        // the only values items.type may hold
  router: router({ create: protectedProcedure.input(...).mutation(...) }),
});
```

- The API refuses to start if two modules share an `id` or an item type.
- Each router is mounted under the module's `id` (`sample.create`, later `tasks.complete`). A module id may not clash with a core router name (`items`, `links`, `search`, `recents`, `auth`, `devices`).
- An item's `type` is checked against the registered types on every create. Types are not a database enum, so a new module needs no Core migration.
- The desktop's `AppRouter` type must include every module router, so the import list has to be static. `apps/api/src/modules.gen.ts` is generated from `modules/*/src/server.ts` by a script that runs before `dev`, `build`, `typecheck` and `test`. Adding a module never needs a hand edit. The generated file is committed so editors resolve types without running the script; CI checks it is up to date.

## Data model

**`items`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Default `uuidv7()`, as `sessions` |
| `type` | text, not null | Checked against registered module item types on create |
| `title` | text, not null | Trimmed, never empty. Shown by palette, recents, backlinks and breadcrumbs without knowing the type |
| `search_text` | text, nullable | Plain text derived by the module from its own content, for search only. Never the source of truth and never sent to the app. Empty for types whose only text is the title |
| `created_at` / `updated_at` | timestamptz, not null | Written by the server rounded to milliseconds, so they compare exactly with JavaScript dates |
| `archived_at` | timestamptz, nullable | Hidden from default lists, still searchable at lower rank |
| `deleted_at` | timestamptz, nullable | Soft delete; purged after 30 days |
| `search` | tsvector, generated | `english` config: `title` weight A, `search_text` weight B |

Indexes: GIN on `search`; trigram GIN on `title` (`pg_trgm`); `(type, updated_at desc)` where `deleted_at is null`.

`search_text` replaces `body_text` from the Core spec. The rename makes clear it is a derived copy the module keeps in sync, not where content lives (a note's content stays in `notes.doc`).

**`links`**: `id` (uuid v7), `from_id`, `to_id`, `kind`, `context` (text, nullable), `created_at`.

- `from_id` and `to_id` reference `items` with `on delete cascade`.
- Unique on (`from_id`, `to_id`, `kind`). Check `from_id <> to_id`.
- `kind` is text, validated by a Zod enum in `@dlh/core`: `contains`, `mentions`, `relates`. `tagged` stays reserved and is rejected.

**`item_views`**: `item_id` (references `items`, cascade), `viewed_at`. Index on `viewed_at desc`.

## Rules

**One write path.** Modules change items only through `@dlh/server`:

```ts
createItem(tx, { type, title, searchText? })                 // returns the item
updateItem(tx, { id, expectedUpdatedAt, title?, searchText? })
setArchived(tx, { id, expectedUpdatedAt, archived })
setDeleted(tx, { id, expectedUpdatedAt, deleted })
```

Each call checks the item exists and is not deleted (except restore), sets `updated_at`, and queues the item id for `/changes`. A module write that touches only its own table (ticking a task) still calls `updateItem` with no fields, so the version moves and other devices refresh. A module's own table and the `items` row are written in one transaction:

```ts
await db.transaction(async (tx) => {
  await updateItem(tx, { id, expectedUpdatedAt, title: input.title });
  await tx.update(tasks).set({ dueAt: input.dueAt }).where(eq(tasks.itemId, id));
});
```

Enforced by:

- `@dlh/db` exports `items`, `links` and `item_views` only on a path modules may not import; a lint check fails a module that imports them.
- A contract test in `@dlh/server/testing` that every module runs against its write calls: after each, `updated_at` moved and a change was published.

**Conflicts.** `updateItem` and friends run `UPDATE … WHERE id = $1 AND updated_at = $2`. No row updated on an existing item means the client's copy is stale: the call fails with `CONFLICT` and the app refetches.

**No containment loops.** Adding a `contains` link first takes a transaction-level advisory lock shared by all `contains` writes, then checks with a recursive query whether `from` is already reachable from `to`. If it is, the link is refused. The lock stops two concurrent links from forming a loop together.

**Membership.** `listContained(id)` walks `contains` links recursively and returns each reachable item once, with the first container it was found through (for "from \<note>" labels). Computed on read, never stored.

**Deleted items.** Deleting sets `deleted_at` and keeps links; restore brings the item back as it was. Every read skips deleted items and links whose other end is deleted. A purge job hard-deletes items deleted more than 30 days ago (cascading to links, views and, later, module tables) and clears views older than 90 days. It runs when the API starts and every 24 hours.

**Change events.** Ids queued during a transaction are published to an in-process bus only after it commits; a rolled-back write publishes nothing. A link change publishes both ends. One API process is enough for one user; Postgres `LISTEN/NOTIFY` replaces the bus if the API ever runs on more than one machine.

## API

**Shared types** (Zod, in `@dlh/core`): `Item` = `id`, `type`, `title`, `createdAt`, `updatedAt`, `archivedAt`. `Link` = `id`, `fromId`, `toId`, `kind`, `context`, `createdAt`. `ItemSummary` = `id`, `type`, `title`, `archivedAt`.

**Core routers** (all signed in)

| Call | Does |
| --- | --- |
| `items.get(id)` | One item; `NOT_FOUND` if missing or deleted |
| `items.list({ types?, includeArchived?, cursor?, limit? })` | Newest `updated_at` first, cursor-paged, limit 50 by default, 200 at most |
| `items.rename({ id, expectedUpdatedAt, title })` | Through `updateItem` |
| `items.archive` / `unarchive` / `delete` / `restore` `({ id, expectedUpdatedAt })` | `restore` works until purge |
| `links.add({ fromId, toId, kind, context? })` | Returns the existing link if already there. A loop fails with `BAD_REQUEST` "would make an item contain itself" |
| `links.remove(id)` | |
| `links.forItem(id)` | `{ outgoing, backlinks }`, each link with an `ItemSummary` of the other end |
| `links.contained(id)` | Contained items at any depth, each once, with the container it was found through |
| `search({ query, types?, limit? })` | `ItemSummary[]`, see below |
| `recents.list()` | Last 10 distinct items opened, newest first, skipping deleted |
| `recents.record(id)` | Writes a view unless the item has one in the last 5 minutes |

There is no core `items.create`: each module creates its own items (`sample.create`, `tasks.create`) so its own row is always written in the same transaction.

Errors: `CONFLICT` (stale `updated_at`), `NOT_FOUND`, `BAD_REQUEST` (unknown type, blank title, rejected link).

**Search**

- A row matches if `search @@ websearch_to_tsquery('english', q)`, or `title % q` (trigram), or `title ilike q || '%'` (prefix; trigram is weak on one or two letters).
- Score: `ts_rank` + trigram similarity on the title + a bonus for a prefix match. Archived items get half their score.
- Blank query returns nothing. Limit 20 by default, 50 at most. Deleted items never appear.
- Target: p95 under 50 ms server time over 10,000 items, checked by a database test.

**`/changes`** (server-sent events on Hono, next to `/trpc`)

- Authenticated with the same `Authorization: Bearer` header as tRPC. The app reads the stream with `fetch` rather than `EventSource`, which can't send headers; the token never goes in the URL.
- Messages are `data: {"ids":[...]}`, batched over 100 ms. A comment line every 25 seconds keeps the connection open through proxies.
- No session, or a revoked or expired one: `401`, and the app signs out as it does for any call.
- Changes made while the app was disconnected are not replayed; the app refreshes instead (below).

## Desktop

**⌘K palette** (in the shell)

- Empty: Recents first, then Go to and the action groups. Each recent shows its type's glyph and colour from `registry.itemTypes`.
- Typing: `search` runs 150 ms after the last keystroke. Results fill Jump to, alongside matching registered actions.
- Choosing a result navigates to the type's `href(id)`. An item whose type no installed module claims is shown disabled with "no module for this type".
- Search fails: Jump to shows "Search unavailable"; actions still work. No matches: "No items match".

**Recents.** `useRecordView(id)` in `@dlh/core`, called by a module's item screen when it opens. The server dedupes, so the hook can fire on every mount.

**Live refresh.** A `ChangesProvider` inside the signed-in part of the app opens `/changes`. For each batch it invalidates queries for those ids, plus all item lists and searches; only queries on screen refetch. It reconnects with backoff, and after a reconnect it invalidates every item query, since missed changes are not replayed.

## Sample module

Still throwaway; it proves a module can do the full round trip.

- `server.ts`: item type `sample`, `sample.create({ title })` via `createItem`.
- Manifest: `itemType` `sample` with `href: (id) => /sample/${id}`.
- `/sample` lists sample items with a "New sample item" field. `/sample/$id` shows one item, records the view, and has a rename field (exercises conflicts and live refresh).
- Seed: `pnpm dev` adds 20 sample items with a few `contains` links when `items` is empty; `pnpm db:reset` seeds again.

## Testing

- **Unit:** server module registry (duplicate ids and types, clashes with core router names); search query building; palette groups; `ChangesProvider` invalidation, through the existing API test harness.
- **Database (`test:db`):** write helpers (conflict, millisecond precision, change published only after commit); links (loop refused, including two concurrent adds; existing link returned; deleted ends hidden); `links.contained` (each item once, with its container); purge; recents dedupe; search ranking; 10,000-item p95 under 50 ms; `/changes` (401 without a session, batch arrives after a write).
- **Module contract:** `@dlh/server/testing` helper, run by the sample module.
- **Lint:** a module importing `items`, `links` or `item_views` from `@dlh/db` fails.
- **Playwright:** sign in, create a sample item, find it in ⌘K, open it, see it in Recents; a script renames it through the API and the open screen updates within 2 seconds.

## Decisions

- **Search language:** `english` (stems "planning" to "plan"). All content is English for now.
