# Items, Links, Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modules can create, link, search and reopen items through a shared data layer: a sample module creates items, ⌘K finds them and lists recents, and an edit from another client shows in the open app within 2 seconds.

**Architecture:** Core tables (`items`, `links`, `item_views`) live in `@dlh/db`. A new `@dlh/server` package holds the tRPC setup (moved from `apps/api`), one transactional write path (`writeItems`) that checks conflicts and publishes changes after commit, the read queries, the core routers and the server module contract. `apps/api` mounts core routers plus every module router listed in a generated `modules.gen.ts`, and serves `/changes` over SSE. A new `@dlh/client` package gives module screens typed API clients through React context. The desktop shell gains ⌘K Recents, Go to and Jump to, and refreshes queries when `/changes` reports a change.

**Tech Stack:** Postgres 18 (`pg_trgm`, generated `tsvector`), Drizzle ORM + drizzle-kit, tRPC v11, Hono (`hono/streaming` `streamSSE`), Zod v4, TanStack Query v5, React 19, Vitest, Playwright.

**Spec:** `docs/specs/items-links-search.md` (Items, Links, Search). Builds on `docs/superpowers/plans/2026-10-30-server-and-sign-in.md`.

**Decisions made while planning (not in the spec):**
- **Write path shape.** The spec sketches `createItem(tx, …)`. Changes must be published only after commit, so writes go through a transaction wrapper instead: `writeItems(deps, async (w) => { await w.createItem(…); await w.tx.insert(…) })`. `w` holds the transaction plus every item and link write. Same rule, enforced by construction.
- **tRPC context.** `@dlh/server` owns `initTRPC`. Its context is `{ deps: CoreDeps & ApiDeps; session: { id; email } | null }`. `ApiDeps` is an empty interface that `apps/api` augments (`declare module "@dlh/server"`) with `config`, `store` and `google`, so the existing auth routers keep reading `ctx.deps.*` unchanged.
- **Module client code.** Modules can't import the desktop's tRPC client. That would create a package cycle: api → modules → desktop types → api. A new `@dlh/client` package provides `useCoreApi()`, `useModuleApi<R>(id)` and `useRecordView(id)` over a client the desktop supplies through context. `useRecordView` moves here from `@dlh/core`, as the spec had it. `@dlh/client` imports server router *types* only.
- **Live refresh scope.** A `/changes` batch invalidates every query except `auth.*` and `devices.*`. That's a superset of the spec's "those ids plus item lists and searches". It needs no query-key convention across modules, and only queries on screen refetch.
- **`updated_at` always increases.** A write sets `updated_at = greatest($now, updated_at + 1 ms)`, using the API clock (`deps.now()`), so two writes in the same millisecond still differ.
- **Module imports.** Modules may not import `@dlh/db` at all. Biome `noRestrictedImports` in the existing `modules/**` override enforces this. A module's own tables (from Tasks onward) get their `Tx` type from `@dlh/server`.
- **Module tests.** Modules test through `@dlh/server/testing` (`createCaller` on their router), not `@dlh/api/testing`. Using the latter would make a module depend on the API, which depends on modules.
- **Seeding.** `defineServerModule` takes an optional `seed(w)`. `pnpm dev` and `pnpm db:reset` run `apps/api/src/cli/seed.ts`, which calls every module's `seed` when `items` is empty.
- **Desktop DB-backed tests.** Desktop tests that need items run as `*.db.test.tsx` under a new desktop `test:db` script, so `pnpm test` still needs no Docker.
- **Palette Go to.** The current palette has no Go to group, though the spec assumed one. This plan adds it: Home, Settings and each module's nav entry, with `G <key>` hints.

## Global Constraints

- Items: `id` uuid default `uuidv7()`; `title` trimmed and never empty (max 500); `search_text` nullable, never sent to the app; `created_at`/`updated_at` written from `deps.now()` (JS `Date`, millisecond precision), never SQL `now()`.
- Search config `english`: `title` weight A, `search_text` weight B.
- Link kinds accepted: `contains`, `mentions`, `relates`. `tagged` is reserved and rejected.
- Soft-deleted items are purged after **30 days**; views older than **90 days** are cleared. The purge runs at API start and every **24 hours**.
- Recents: last **10** distinct items; one view per item per **5 minutes**.
- Search: blank query returns `[]`; default limit **20**, max **50**; archived score ×**0.5**; p95 under **50 ms** over **10,000** items.
- `items.list`: default limit **50**, max **200**, ordered `updated_at desc, id desc`.
- `/changes`: same `Authorization: Bearer` header as tRPC, never a token in the URL. Batches over **100 ms**, keep-alive comment every **25 s**, `401` without a valid session.
- Desktop: search runs **150 ms** after the last keystroke. Reconnect backoff `min(30 s, 1 s × 2^attempt)`.
- Errors: `CONFLICT` (stale `updated_at`), `NOT_FOUND` (missing or deleted), `BAD_REQUEST` (unknown type, blank title, rejected link). Loop message exactly: `would make an item contain itself`.
- Dates cross the wire as ISO-8601 strings. No superjson.
- Everything in the earlier plans' Global Constraints still holds: strict TS, Biome, layout-only Tailwind in modules, `pnpm test` with no Docker, DB tests in `test:db`, macOS and Windows.

## Review Focus

1. **Two writes in the same millisecond** (frozen test clock, fast double-click): the second write must still advance `updated_at`, so a client holding the first version gets `CONFLICT`. Test in Task 3.
2. **Hostile or odd search input** (`%`, `_`, `\`, `'`, `&`, `:*`, `!`, a stopword-only query like `the`, emoji, 1 000 characters): no SQL error. `%` and `_` match literally in the prefix test, and the query is trimmed and capped at 200 characters. Test in Task 5.
3. **Deleted items in the middle of a containment path:** `links.contained` and `links.forItem` don't walk through or return deleted items. Restoring the item brings the path back. The loop check still counts deleted items, so restoring can never create a loop. Tests in Task 4.
4. **Session revoked while `/changes` is open:** the server rechecks the session on each keep-alive and closes the stream. The client's reconnect then gets `401` and signs out instead of retrying forever. A closed connection unsubscribes from the bus, so nothing leaks. Tests in Tasks 8 and 9.
5. **Out-of-order search responses while typing fast:** results for an older query must never replace results for the current one. Test in Task 11.

---

## File structure

```
packages/
  db/src/schema.ts                       + items, links, itemViews (+ tsvector custom type)
  db/drizzle/0001_pg_trgm.sql            custom migration: create extension pg_trgm
  db/drizzle/0002_*.sql                  generated: items, links, item_views
  core/src/items.ts                      Zod: item, itemSummary, link, linkKind, inputs
  server/                                NEW @dlh/server
    src/trpc.ts                          initTRPC, Context, CoreDeps, ApiDeps, router, procedures
    src/changes.ts                       createChangeBus
    src/modules.ts                       defineServerModule, collectServerModules
    src/items/writer.ts                  writeItems, ItemWriter
    src/items/links.ts                   addLink/removeLink (used by writer), loop check
    src/items/read.ts                    getItem, listItems, linksForItem, listContained
    src/items/search.ts                  searchItems, escapeLike
    src/items/recents.ts                 recordView, listRecents
    src/items/purge.ts                   purgeExpired
    src/routers.ts                       items, links, search, recents routers; coreRouters; CoreRouter type
    src/testing.ts                       testDeps, expectTracked, freshTestDb re-export
    src/index.ts
  client/                                NEW @dlh/client
    src/index.tsx                        ApiClientProvider, useCoreApi, useModuleApi, useRecordView
  ui/src/patterns/CommandBar.tsx         + item.disabled, group.message, groups "recent" | "goto"
modules/sample/
  src/server.ts                          item type "sample", sample.create, seed
  src/manifest.tsx                       + itemType, detail route
  src/SamplePage.tsx, src/SampleItemPage.tsx
  test/server.db.test.ts
apps/api/
  src/trpc.ts                            reduced to createContext + ApiDeps augmentation
  src/modules.gen.ts                     GENERATED, committed
  src/router.ts                          auth + devices + core + module routers
  src/changes.ts                         /changes SSE handler
  src/cli/seed.ts                        seed when empty
  src/main.ts                            + module registry, purge job
scripts/gen-modules.ts (+ .test.ts)      writes/checks apps/api/src/modules.gen.ts
apps/desktop/
  src/api/changes.ts                     createSseParser, subscribeChanges
  src/api/ChangesProvider.tsx
  src/shell/palette.ts                   pure group builders
  src/shell/Shell.tsx                    palette wiring
  src/App.tsx                            + ApiClientProvider, ChangesProvider
  e2e/items.spec.ts
```

---

### Task 1: Core tables and shared item schemas

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`
- Create: `packages/db/drizzle/0001_pg_trgm.sql` (via `drizzle-kit generate --custom --name pg_trgm`), then the generated `0002_*.sql`
- Create: `packages/core/src/items.ts`; modify `packages/core/src/index.ts`, `packages/core/package.json` (add `zod` dependency)
- Test: `packages/db/test/items.db.test.ts`, `packages/core/test/items.test.ts`

**Interfaces:**
- Produces (`@dlh/db`): `items`, `links`, `itemViews` Drizzle tables, exported from the root entry. Columns use camelCase names in TS: `searchText`, `createdAt`, `updatedAt`, `archivedAt`, `deletedAt`, `fromId`, `toId`, `itemId`, `viewedAt`.
- Produces (`@dlh/core`): `linkKind` (`z.enum(["contains","mentions","relates"])`), `itemTitle` (`z.string().trim().min(1).max(500)`), `item` (`{ id, type, title, createdAt, updatedAt, archivedAt: string | null }`), `itemSummary` (`{ id, type, title, archivedAt }`), `link` (`{ id, fromId, toId, kind, context: string | null, createdAt }`), `listCursor` (`{ updatedAt: iso, id: uuid }`), plus inferred types `Item`, `ItemSummary`, `Link`, `LinkKind`, `ListCursor`.

- [ ] **Step 1: Write the failing DB test** `packages/db/test/items.db.test.ts` using `freshTestDb()`:
  - `search is generated from title (A) and search_text (B)`: insert `{ type: "t", title: "Quarterly planning", searchText: "vendor contracts" }`, then `select ts_rank(search, to_tsquery('english','plan')) > ts_rank(search, to_tsquery('english','vendor'))` is true.
  - `pg_trgm is installed`: `select similarity('planning','planing') > 0.3` is true.
  - `links reject self-links and duplicates`: inserting `from_id = to_id` throws; inserting the same (`from`,`to`,`kind`) twice throws.
  - `deleting an item cascades to links and views`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/db test:db`. Expected: FAIL (relation "items" does not exist).
- [ ] **Step 3: Add the tables** to `schema.ts`. Use a `customType` `tsvector`, and define `search` with `.generatedAlwaysAs(sql\`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(search_text, '')), 'B')\`)`. Indexes:
  - `items_search_idx` gin(`search`)
  - `items_title_trgm_idx` gin(`title gin_trgm_ops`)
  - `items_type_updated_idx` on (`type`, `updated_at desc`) where `deleted_at is null`
  - `links_from_to_kind_uq` unique
  - `links_to_idx` on `to_id`
  - `item_views_viewed_idx` on `viewed_at desc`
  - `item_views_item_idx` on (`item_id`, `viewed_at desc`)
  
  Add a check `links_no_self` (`from_id <> to_id`). `links.id` and `items.id` default `uuidv7()`.
- [ ] **Step 4: Generate migrations.** First `pnpm --filter @dlh/db exec drizzle-kit generate --custom --name pg_trgm`, and write `create extension if not exists pg_trgm;` into it. Then `pnpm --filter @dlh/db generate`. Expected: two new files in `packages/db/drizzle/`, with the extension migration ordered first.
- [ ] **Step 5: Run** `pnpm --filter @dlh/db test:db`. Expected: PASS.
- [ ] **Step 6: Core schemas.** Write `packages/core/test/items.test.ts`:
  - `linkKind` rejects `"tagged"`
  - `itemTitle` turns `"  Plan  "` into `"Plan"` and rejects `"   "`
  - `item` rejects a missing `archivedAt`
  
  Run it (FAIL), implement `packages/core/src/items.ts`, run `pnpm --filter @dlh/core test` (PASS).
- [ ] **Step 7: Commit** `feat(db): items, links and item_views tables with full-text and trigram search`.

---

### Task 2: `@dlh/server` package — tRPC setup, change bus, module registry

**Files:**
- Create: `packages/server/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,trpc,changes,modules}.ts`
- Modify: `apps/api/src/trpc.ts` (keep only `createContext` and the `ApiDeps` augmentation), `apps/api/src/app.ts`, `apps/api/src/routers/*.ts` (import `router`/procedures from `@dlh/server`), `apps/api/src/testing.ts`, `apps/api/src/main.ts`, `apps/api/package.json` (add `@dlh/server`)
- Test: `packages/server/test/changes.test.ts`, `packages/server/test/modules.test.ts`

**Interfaces:**
- Produces (`@dlh/server`):
  - `type CoreDeps = { db: Db; changes: ChangeBus; itemTypes: ReadonlySet<string>; now: () => Date; devErrors: boolean }`
  - `interface ApiDeps {}` (augmented by `apps/api`)
  - `type Session = { id: string; email: string }`
  - `type Context = { deps: CoreDeps & ApiDeps; session: Session | null }`
  - `router`, `publicProcedure`, `protectedProcedure` (the error formatter strips the stack unless `ctx.deps.devErrors`)
  - `type Tx` (a Drizzle transaction of `Db`)
  - `createChangeBus(): ChangeBus`, where `ChangeBus = { publish(ids: Iterable<string>): void; subscribe(fn: (ids: string[]) => void): () => void; size(): number }` (`size` is the subscriber count, used by Task 8's tests)
  - `defineServerModule<const Id extends string, R extends AnyRouter>(m: ServerModule<Id, R>): ServerModule<Id, R>`, where `ServerModule<Id, R> = { id: Id; itemTypes: string[]; router: R; seed?: (w: ItemWriter) => Promise<void> }`. The generics keep literal ids and router types for Task 7's app router type. `ItemWriter` comes from Task 3; declare the field with a forward type import.
  - `collectServerModules(mods: ServerModule[], reservedIds: string[]): { modules: ServerModule[]; itemTypes: Set<string> }`, which throws `ServerModuleError`
  - `CORE_ROUTER_IDS = ["auth","devices","items","links","search","recents"] as const`
- Consumes: `Db` from `@dlh/db`.

- [ ] **Step 1: Write failing tests.**
  - `changes.test.ts`:
    - a subscriber receives `["a","b"]` for `publish(["a","b","a"])` (deduped, order of first appearance)
    - after unsubscribe it receives nothing
    - `publish([])` calls no one
  - `modules.test.ts`:
    - duplicate id throws ``Duplicate server module id "x"``
    - two modules claiming `"note"` throw ``Item type "note" is claimed by modules "a" and "b"``
    - id `"items"` throws ``Module id "items" clashes with a core router``
    - valid input returns the union of item types
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the package. `package.json` follows `@dlh/db`'s style: `exports` `"."` → `./src/index.ts` and `"./testing"` → `./src/testing.ts`; scripts `test` (excluding `*.db.test.ts`), `test:db`, `typecheck`; dependencies `@dlh/core`, `@dlh/db`, `@trpc/server`, `drizzle-orm`, `zod`.
- [ ] **Step 4: Move the API onto it.**
  - Change `apps/api/src/trpc.ts` to:
    ```ts
    declare module "@dlh/server" {
      interface ApiDeps { config: Config; store: AuthStore; google: GoogleOAuth }
    }
    export type AppDeps = CoreDeps & ApiDeps;
    ```
    plus `createContext`, which now returns `session: { id, email } | null`.
  - `createApp(deps: AppDeps)` is unchanged otherwise.
  - In `main.ts` and `createTestApi`, build `changes: createChangeBus()`, `itemTypes: new Set()` and `devErrors: config.devAuth`.
  - `createTestApi` gains `opts.db?: Db`. Without it, pass a `Proxy` that throws `"createTestApi: no database — pass { db } (DB tests only)"` on any property access.
- [ ] **Step 5: Run** `pnpm --filter @dlh/server test && pnpm --filter @dlh/api test && pnpm typecheck`. Expected: all PASS. Existing auth and devices tests are unchanged.
- [ ] **Step 6: Commit** `refactor(server): move tRPC setup into @dlh/server; add change bus and server module registry`.

---

### Task 3: Item writer — create, update, archive, delete, conflicts, change events

**Files:**
- Create: `packages/server/src/items/writer.ts`, `packages/server/src/testing.ts`
- Test: `packages/server/test/writer.db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ItemWriter {
    tx: Tx;
    createItem(i: { type: string; title: string; searchText?: string | null }): Promise<Item>;
    updateItem(i: { id: string; expectedUpdatedAt: string; title?: string; searchText?: string | null }): Promise<Item>;
    setArchived(i: { id: string; expectedUpdatedAt: string; archived: boolean }): Promise<Item>;
    setDeleted(i: { id: string; expectedUpdatedAt: string; deleted: boolean }): Promise<Item>;
    addLink(i: { fromId: string; toId: string; kind: LinkKind; context?: string | null }): Promise<Link>; // Task 4
    removeLink(id: string): Promise<void>;                                                             // Task 4
  }
  function writeItems<T>(deps: CoreDeps, fn: (w: ItemWriter) => Promise<T>): Promise<T>;
  ```
  `@dlh/server/testing`:
  - `freshTestDb` (re-exported from `@dlh/db/testing`)
  - `testDeps(db, opts?: { itemTypes?: string[]; now?: () => Date }): CoreDeps`, with defaults `["test"]` and a settable clock
  - `expectTracked(deps, opts: { itemId?: string }, run: () => Promise<{ id: string } | unknown>): Promise<void>`. It asserts the id (`opts.itemId`, or the `id` `run` returns) was published, and, when `opts.itemId` is given, that its `updated_at` increased.

- [ ] **Step 1: Write failing DB tests** (`writer.db.test.ts`, with a frozen `now` at `2026-10-30T12:00:00.000Z`):
  - `createItem trims the title, stamps created/updated from deps.now and publishes after commit`. While inside `fn`, the subscriber has received nothing. After `writeItems` resolves, it has received `[id]`.
  - `rolled back writes publish nothing`: `fn` creates an item, then throws. Expect no publish and no row.
  - `unknown type → BAD_REQUEST`, `blank title → BAD_REQUEST`.
  - `updateItem with a stale expectedUpdatedAt → CONFLICT`. `missing or deleted id → NOT_FOUND`.
  - `two updates in the same millisecond still advance updated_at` (Review Focus 1). Without moving the clock: update A → `t1`, update with `t1` → `t2`. Assert `t2 > t1`, and that updating with `t1` again → `CONFLICT`.
  - `updated_at round-trips exactly`: the returned `updatedAt` passed back as `expectedUpdatedAt` succeeds.
  - `setDeleted(true) then setDeleted(false) restores`. `setArchived` sets and clears `archivedAt`.
  - `updateItem with no fields still advances the version and publishes` (the "module touched only its own table" case).
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db`. Expected: FAIL.
- [ ] **Step 3: Implement `writeItems`.**
  - It runs `deps.db.transaction`, collects changed ids in a `Set`, and calls `deps.changes.publish` only after the transaction resolves.
  - Every update is one statement: `update items set …, updated_at = greatest($now, updated_at + interval '1 millisecond') where id = $id and updated_at = $expected and deleted_at is null` (restore uses `deleted_at is not null`) `returning *`.
  - When it returns no row, run `select deleted_at from items where id = $id` to tell `NOT_FOUND` from `CONFLICT`.
  - Throw `TRPCError`s. Map rows to `Item` with ISO strings.
- [ ] **Step 4: Run** `pnpm --filter @dlh/server test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): transactional item writer with conflict checks and post-commit change events`.

---

### Task 4: Links — add, remove, loop check, backlinks, containment

**Files:**
- Create: `packages/server/src/items/links.ts`, `packages/server/src/items/read.ts`
- Modify: `packages/server/src/items/writer.ts` (wire `addLink`/`removeLink`)
- Test: `packages/server/test/links.db.test.ts`

**Interfaces:**
- Produces:
  - `getItem(db, id): Promise<Item>` (`NOT_FOUND` if missing or deleted)
  - `listItems(db, { types?, includeArchived?, cursor?, limit? }): Promise<{ items: Item[]; nextCursor: ListCursor | null }>`
  - `linksForItem(db, id): Promise<{ outgoing: LinkWithItem[]; backlinks: LinkWithItem[] }>`, where `LinkWithItem = Link & { item: ItemSummary }` and `item` is the other end
  - `listContained(db, id): Promise<{ item: ItemSummary; via: ItemSummary }[]>`
- Consumes: `ItemWriter` from Task 3.

- [ ] **Step 1: Write failing DB tests.**
  - `addLink returns the existing link when repeated` (same id, one row, no error).
  - `addLink publishes both ends`; `removeLink publishes both ends`; `removeLink` on a missing id → `NOT_FOUND`.
  - `tagged → BAD_REQUEST`; `a link to a missing or deleted item → NOT_FOUND`.
  - `A contains B, B contains C: C contains A → BAD_REQUEST "would make an item contain itself"`.
  - `concurrent adds can't form a loop`: run `A→B` and `B→A` in two `writeItems` calls with `Promise.allSettled`. Exactly one fulfils.
  - `loop check counts deleted items` (Review Focus 3): A⊃B, delete B, then B⊃A → refused.
  - `listContained`: P⊃N, N⊃T, P⊃T. T is listed once, with `via` = P (shallowest path wins). A deleted N hides tasks reachable only through N, and restoring N brings them back (Review Focus 3).
  - `linksForItem hides links whose other end is deleted`; backlinks list `to_id = X`.
  - `listItems` pages: 3 items, `limit: 2` → 2 items plus a cursor, then the next page → 1 item and `null`. Archived items are hidden unless `includeArchived`; `limit: 500` → `BAD_REQUEST`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** `addLink` for `kind = 'contains'` first runs `select pg_advisory_xact_lock(7243001)`, then the loop check. The loop check deliberately ignores `deleted_at`:
  ```sql
  with recursive reach(id) as (
    select to_id from links where from_id = $to and kind = 'contains'
    union
    select l.to_id from links l join reach r on l.from_id = r.id where l.kind = 'contains'
  ) select exists (select 1 from reach where id = $from)
  ```
  Insert with `on conflict (from_id, to_id, kind) do nothing returning *`. If nothing comes back, select the existing row. `listContained` uses a recursive CTE carrying `depth` and the parent id. It joins only non-deleted items at every step, and picks per item `distinct on (id) order by depth, link.created_at`.
- [ ] **Step 4: Run** `pnpm --filter @dlh/server test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): links with loop prevention, backlinks and containment`.

---

### Task 5: Search, recents and purge

**Files:**
- Create: `packages/server/src/items/{search,recents,purge}.ts`
- Test: `packages/server/test/search.db.test.ts`, `packages/server/test/search.perf.db.test.ts`, `packages/server/test/recents.db.test.ts`, `packages/server/test/search.test.ts` (unit, for `escapeLike`)

**Interfaces:**
- Produces:
  - `searchItems(db, { query: string; types?: string[]; limit?: number }): Promise<ItemSummary[]>`
  - `escapeLike(s: string): string`
  - `recordView(deps, id): Promise<void>` (`NOT_FOUND` if missing or deleted; publishes nothing)
  - `listRecents(db): Promise<ItemSummary[]>`
  - `purgeExpired(deps): Promise<{ items: number; views: number }>`

- [ ] **Step 1: Write failing tests.**
  - Unit: `escapeLike("50%_a\\b")` → `"50\\%\\_a\\\\b"`.
  - `search.db.test.ts`:
    - `"plan"` finds "Quarterly planning" (stemming).
    - `"plnning"` finds it (trigram).
    - `"q"` finds "Q4 review" (prefix).
    - A title match outranks a `search_text`-only match.
    - An archived item ranks below an equal live one.
    - Deleted items never appear.
    - `types` filters.
    - `"   "` → `[]`.
    - `limit: 51` → `BAD_REQUEST`.
    - **Hostile input** (Review Focus 2): each of `%`, `_`, `\`, `'`, `a & b`, `foo:*`, `!`, `the`, `🚀`, `"x".repeat(1000)` resolves without throwing. `"50%"` doesn't match "500 items" through the prefix rule.
  - `search.perf.db.test.ts`:
    - insert 10,000 items with `generate_series` (titles built from a 200-word list, `search_text` of 20 words), then run `analyze items`
    - run 30 queries (single words, two words, typos, one-letter prefixes)
    - p95 of `performance.now()` deltas < 50 ms
  - `recents.db.test.ts`:
    - two views 4 minutes apart → one row; 6 minutes apart → two rows
    - `listRecents` returns at most 10 distinct items, newest first, skipping deleted
    - `purgeExpired` deletes items deleted 31 days ago but keeps those deleted 29 days ago, and deletes views older than 90 days
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test && pnpm --filter @dlh/server test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Trim the query and cut it to 200 characters. Then:
  ```sql
  with q as (select websearch_to_tsquery('english', $q) as tsq)
  select id, type, title, archived_at,
    (ts_rank(search, q.tsq) + similarity(title, $q)
      + case when title ilike $prefix escape '\' then 0.5 else 0 end)
    * case when archived_at is null then 1 else 0.5 end as score
  from items, q
  where deleted_at is null and ($types::text[] is null or type = any($types))
    and (search @@ q.tsq or title % $q or title ilike $prefix escape '\')
  order by score desc, updated_at desc
  limit $limit
  ```
  `$prefix = escapeLike(q) + '%'`. Recents: `select … from item_views v join items i … where i.deleted_at is null group by i.id order by max(v.viewed_at) desc limit 10`. `recordView` inserts only `where not exists (… viewed_at > $now - interval '5 minutes')`.
- [ ] **Step 4: Run** both suites. Expected: PASS, with the perf test under 50 ms p95.
- [ ] **Step 5: Commit** `feat(server): ranked search, recents and purge`.

---

### Task 6: Core routers mounted in the API

**Files:**
- Create: `packages/server/src/routers.ts`; modify `packages/server/src/index.ts`
- Modify: `apps/api/src/router.ts`
- Test: `apps/api/test/items.db.test.ts`, plus `"test:db"` in `apps/api/package.json` already matches it

**Interfaces:**
- Produces:
  - `coreRouters = { items, links, search, recents }`, all `protectedProcedure`
  - `type CoreRouter = ReturnType<typeof router<typeof coreRouters>>`

  Calls and inputs follow the spec's API table:
  - `items.get({ id })`
  - `items.list({ types?, includeArchived?, cursor?, limit? })`
  - `items.rename({ id, expectedUpdatedAt, title })`
  - `items.archive|unarchive|delete|restore({ id, expectedUpdatedAt })`
  - `links.add`, `links.remove({ id })`, `links.forItem({ id })`, `links.contained({ id })`
  - `search({ query, types?, limit? })`
  - `recents.list()`, `recents.record({ id })`

  Outputs use the `@dlh/core` schemas.
- Consumes: Tasks 3–5.

- [ ] **Step 1: Write a failing API DB test.** Use `createTestApi({ db, devAuth: true })` with `itemTypes` `["test"]`; this adds an `itemTypes` option to `createTestApi`. Since there's no core `create`, the test seeds through `writeItems(api.deps, …)`, which means `createTestApi` must also return `deps`. Then:
  - every call without a token → `UNAUTHORIZED`
  - a rename round-trip
  - a stale rename → `CONFLICT`
  - `search` finds the renamed title
  - `recents.record` then `recents.list`
  - `links.add` / `forItem` / `contained`
  - outputs never contain `searchText`
- [ ] **Step 2: Run** `pnpm --filter @dlh/api test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** the routers and mount them: `appRouter = router({ auth, devices, ...coreRouters, ...moduleRouters })`. `moduleRouters` stays `{}` until Task 7.
- [ ] **Step 4: Run** `pnpm --filter @dlh/api test:db && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): items, links, search and recents routers`.

---

### Task 7: Server modules — generated list, sample module server, seed, import rule

**Files:**
- Create: `scripts/gen-modules.ts`, `scripts/gen-modules.test.ts`, `apps/api/src/modules.gen.ts` (generated), `apps/api/src/cli/seed.ts`
- Create: `modules/sample/src/server.ts`, `modules/sample/vitest.config.ts`, `modules/sample/test/server.db.test.ts`
- Modify:
  - `modules/sample/package.json`: dependencies `@dlh/server`, `@trpc/server`, `zod`; scripts `test:db`, `test` (`--passWithNoTests`)
  - `apps/api/src/router.ts`, `apps/api/src/main.ts`, `apps/api/src/testing.ts`
  - `apps/api/package.json`: `gen` runs before `dev`, `build` and `typecheck`; add a `seed` script
  - root `package.json`: `gen:modules`; `lint` runs `tsx scripts/gen-modules.ts --check`; `db:reset` becomes `pnpm --filter @dlh/db reset && pnpm --filter @dlh/api seed`
  - `scripts/dev.ts` and `scripts/dev.test.ts`: a `seed` step after `migrate`
  - `biome.json`
- Test: as listed

**Interfaces:**
- Produces:
  - `renderModulesFile(serverFiles: string[]): string`, exported from `gen-modules.ts`. The paths are relative to `apps/api/src`, sorted.
  - The generated file exports `serverModules = [sample] as const`, using relative imports such as `import sample from "../../../modules/sample/src/server";`.
  - `apps/api/src/router.ts` folds `serverModules` into the app router keyed by module id. The type must stay precise, e.g. `{ [M in (typeof serverModules)[number] as M["id"]]: M["router"] }`, so `defineServerModule` must preserve literal `id` and router types (make it generic: `defineServerModule<const Id extends string, R extends AnyRouter>`).
  - `main.ts` and `createTestApi` build `itemTypes` from `collectServerModules(serverModules, [...CORE_ROUTER_IDS])`.
  - `seedIfEmpty(deps, modules): Promise<boolean>` in `apps/api/src/cli/seed.ts`.
  - The sample module exports `type SampleRouter`.

- [ ] **Step 1: Write failing tests.**
  - `gen-modules.test.ts`: `renderModulesFile(["../../../modules/b/src/server.ts","../../../modules/a/src/server.ts"])` sorts a before b, imports without the `.ts` extension, and starts with `// GENERATED by scripts/gen-modules.ts — do not edit.`
  - `modules/sample/test/server.db.test.ts`, with `testDeps(db, { itemTypes: ["sample"] })` and `sampleServer.router.createCaller({ deps, session: { id: "s", email: "e" } })`:
    - `create({ title: " Hello " })` returns an `Item` titled `Hello` with type `sample`
    - `expectTracked` passes for create
    - `seed` creates 20 items and some `contains` links
    - a blank title → `BAD_REQUEST`
  - Add to `apps/api/test/items.db.test.ts`: `sample.create` is reachable through the app router; `seedIfEmpty` seeds once and returns `false` the second time.
- [ ] **Step 2: Run** `pnpm test:scripts && pnpm --filter @dlh/module-sample test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `gen-modules.ts` globs `modules/*/src/server.ts`. `--check` exits 1 with `apps/api/src/modules.gen.ts is out of date — run pnpm gen:modules` when the file differs.
  - Biome: add `"@dlh/db": "Modules change items through @dlh/server, never @dlh/db directly."` to the existing `modules/**` `noRestrictedImports` paths.
- [ ] **Step 4: Verify the import rule.** Temporarily add `import "@dlh/db";` to `modules/sample/src/server.ts` and run `pnpm lint`. Expected: an error naming the rule. Then remove the import.
- [ ] **Step 5: Run** `pnpm lint && pnpm test && pnpm test:db && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: server modules with a generated registry; sample module creates and seeds items`.

---

### Task 8: `/changes` stream and the purge job

**Files:**
- Create: `apps/api/src/changes.ts`
- Modify: `apps/api/src/app.ts` (mount `GET /changes`), `apps/api/src/main.ts` (purge job)
- Test: `apps/api/test/changes.test.ts`

**Interfaces:**
- Produces:
  - `changesHandler(deps: AppDeps, opts?: { batchMs?: number; heartbeatMs?: number })`, a Hono handler. Defaults are 100 and 25 000.
  - `startPurgeJob(deps, everyMs = 86_400_000): () => void`, which runs once immediately, then on an `unref`'d interval, and logs failures without throwing.
- Consumes: `authenticate` (existing), `deps.changes`.

- [ ] **Step 1: Write failing tests.** These are unit tests: the memory store is enough and the bus is fed directly. Read the stream through `api.app.fetch` and the body reader.
  - `no token → 401`; `revoked token → 401`.
  - `publishes within a batch arrive as one event`: publish `["a"]` then `["b","a"]` within 100 ms → exactly one `data: {"ids":["a","b"]}`.
  - `heartbeat comment` (`heartbeatMs: 20`): the stream contains `: ping`.
  - `revoking the session closes the stream at the next heartbeat` (Review Focus 4).
  - `cancelling the reader unsubscribes`: the bus's subscriber count goes back to 0. Expose `size()` on `ChangeBus` for this.
- [ ] **Step 2: Run** `pnpm --filter @dlh/api test`. Expected: FAIL.
- [ ] **Step 3: Implement** with `streamSSE` from `hono/streaming`. CORS already allows `GET`. On each heartbeat, call `authenticate` again and close the stream if it returns null. `stream.onAbort` clears the timers and unsubscribes.
- [ ] **Step 4: Run** `pnpm --filter @dlh/api test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): /changes server-sent events and the daily purge job`.

---

### Task 9: `@dlh/client` and live refresh in the desktop

**Files:**
- Create: `packages/client/{package.json,tsconfig.json,vitest.config.ts}`, `packages/client/src/index.tsx`, `packages/client/test/client.test.tsx`
- Create: `apps/desktop/src/api/changes.ts`, `apps/desktop/src/api/ChangesProvider.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/package.json` (deps `@dlh/client`; script `test:db`; `test` excludes `*.db.test.tsx`), `apps/desktop/vitest.config.ts` if it needs the include pattern
- Test: `apps/desktop/test/changes.test.ts`, `apps/desktop/test/changesProvider.test.tsx`

**Interfaces:**
- Produces (`@dlh/client`):
  - `ApiClientProvider({ client: unknown, children })`
  - `useCoreApi(): TRPCClient<CoreRouter>`
  - `useModuleApi<R extends AnyRouter>(moduleId: string): TRPCClient<R>`, which returns `(client as any)[moduleId]`
  - `useRecordView(id: string | undefined): void`, which calls `recents.record` once per id per mount and swallows errors

  It imports `CoreRouter` and `AnyRouter` with `import type` only.
- Produces (desktop):
  - `createSseParser(onData: (data: string) => void): (chunk: string) => void`, which handles chunks split mid-line, ignores `:` comments, and joins multi-line `data:`
  - `subscribeChanges({ url, getToken, fetch?, onIds, onReconnect, onUnauthorized, backoffMs? }): () => void`
  - `<ChangesProvider>`, which is only rendered while signed in

- [ ] **Step 1: Write failing tests.**
  - `changes.test.ts`:
    - the parser receives `"data: {\"ids\":[\"a\""` then `"]}\n\n: ping\n\n"` and emits once (chunk split mid-line, comment ignored)
    - `subscribeChanges` against a fake `fetch`:
      - sends `Authorization: Bearer t`
      - a `401` calls `onUnauthorized` and stops without retrying (Review Focus 4)
      - a dropped stream retries after `backoffMs(0)`, then calls `onReconnect` once the new connection opens
      - the backoff caps at 30 000
      - the returned stop function aborts the fetch
  - `changesProvider.test.tsx`, with a `QueryClient` holding queries keyed the way `@trpc/tanstack-react-query` keys them: `[["auth","me"],{type:"query"}]`, `[["devices","list"],{type:"query"}]` and `[["items","get"],{input:{id:"a"},type:"query"}]` plus a fake subscribe: an ids event invalidates the items query only.
  - `client.test.tsx`: `useModuleApi("sample")` returns the `sample` property of the provided client. `useRecordView("x")` calls `recents.record.mutate({ id: "x" })` once across re-renders.
- [ ] **Step 2: Run** `pnpm --filter @dlh/client test && pnpm --filter @dlh/desktop test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ChangesProvider` invalidates with `predicate: (q) => !isAuthOrDevicesKey(q.queryKey)`. tRPC query keys start with a path array such as `["auth","me"]`, so match on `queryKey[0][0]`. An `onReconnect` invalidates the same set. `onUnauthorized` calls `useAuth().signOut()`. `App.tsx` wraps the router in `ApiClientProvider` and, while signed in, in `ChangesProvider`.
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): live refresh from /changes; @dlh/client hooks for module screens`.

---

### Task 10: CommandBar — Recents and Go to groups, disabled rows, group messages

**Files:**
- Modify: `packages/ui/src/patterns/CommandBar.tsx`, its gallery story under `packages/ui/src/gallery/stories/`, and the CommandBar test in `packages/ui/test/`
- Test: the existing CommandBar test file; new screenshot `patterns-command-bar-recents`

**Interfaces:**
- Produces:
  - `CommandGroup.id` gains `"recent" | "goto"`
  - `ORDER = ["recent","goto","create","actions","ai","jump"]`
  - `CommandItem.disabled?: boolean`: rendered with `aria-disabled="true"` and the muted text token. ↑/↓ skip it, Enter and click do nothing.
  - `CommandGroup.message?: string`: a group with no items but a message still renders, with the message in place of rows (for "Search unavailable" and "No items match")

- [ ] **Step 1: Write failing tests.**
  - The groups render in `ORDER`.
  - ↓ skips a disabled row.
  - Clicking a disabled row neither calls `onAction` nor closes.
  - A `{ id: "jump", label: "Jump to", items: [], message: "No items match" }` group renders its label and the message.
  - The palette-wide "No results" text shows only when no group has items or a message.
- [ ] **Step 2: Run** `pnpm --filter @dlh/ui test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add a `recents` story (Recents + Go to with `G H` hints + a disabled row).
- [ ] **Step 4: Run** `pnpm --filter @dlh/ui test && pnpm --filter @dlh/ui test:screens --update-snapshots` on macOS. Check the new baseline image, then run `test:screens` again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): command bar recents and go-to groups, disabled rows and group messages`.

---

### Task 11: ⌘K palette — Recents, Go to, Jump to, matching actions

**Files:**
- Create: `apps/desktop/src/shell/palette.ts`, `apps/desktop/src/shell/useDebouncedValue.ts`
- Modify: `apps/desktop/src/shell/Shell.tsx`
- Test: `apps/desktop/test/palette.test.ts`, `apps/desktop/test/palette.db.test.tsx`

**Interfaces:**
- Produces (pure, in `palette.ts`):
  - `matchesQuery(label: string, keywords: string[] | undefined, query: string): boolean` (case-insensitive substring; an empty query matches)
  - `itemRows(items: ItemSummary[], itemTypes: ModuleRegistry["itemTypes"], navigate): CommandItem[]`. Each row has its type's glyph and colour. Items whose type no module claims get `disabled: true, hint: "no module for this type"`.
  - `goToRows(nav, navigate): CommandItem[]`: Home (`G H`), each module nav entry with a key (`G <KEY>`), then Settings
  - `jumpGroup(state: { status: "idle" | "loading" | "error" | "ok"; items: CommandItem[] }): CommandGroup | null`. `error` → message `Search unavailable`; `ok` with no rows → `No items match`; `idle` → `null`.
- Consumes: `trpc.search.queryOptions`, `trpc.recents.list.queryOptions` (desktop `useTRPC`), Task 10's CommandBar.

- [ ] **Step 1: Write failing tests.**
  - `palette.test.ts` covers each pure function, including the disabled row for type `"ghost"`, and `matchesQuery("Hello from Sample", ["greet"], "GREE")` → true.
  - `palette.db.test.tsx`, using `signedInApp` with a DB:
    - with an empty query, ⌘K shows Recents (seed a view first) and Go to
    - typing `hel` shows "Hello item" under Jump to, and the "Hello from Sample" action under Actions
    - a typo still finds it
    - choosing it navigates to `/sample/<id>`
    - **out-of-order responses** (Review Focus 5): wrap the harness `fetch` so the response for `h` is delayed past the one for `hello`. Only `hello`'s results are shown.
    - when the harness `fetch` fails `search` with a 500, Jump to shows `Search unavailable` and actions still show
- [ ] **Step 2: Run** `pnpm --filter @dlh/desktop test && pnpm --filter @dlh/desktop test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** in `Shell.tsx`:
  - `useDebouncedValue(query, 150)`
  - `useQuery({ ...trpc.search.queryOptions({ query: debounced }), enabled: open && debounced.trim() !== "" })`. The query key includes the text, so stale responses can't win.
  - `recents.list` is enabled only while open with an empty query.
  - Show `recent` and `goto` only for an empty query; filter actions with `matchesQuery`.
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): command palette searches items and shows recents`.

---

### Task 12: Sample module screens

**Files:**
- Modify: `modules/sample/src/manifest.tsx`, `modules/sample/src/SamplePage.tsx`, `modules/sample/package.json` (deps `@dlh/client`, `@tanstack/react-query`)
- Create: `modules/sample/src/SampleItemPage.tsx`
- Test: `apps/desktop/test/sample.db.test.tsx` (module screens are tested through the desktop harness, as Devices is)

**Interfaces:**
- Consumes: `useCoreApi`, `useModuleApi<SampleRouter>("sample")`, `useRecordView` (Task 9).
- Produces:
  - manifest `itemType: { type: "sample", label: "Sample", glyph: "FlaskConical", color: "var(--color-type-ai)", href: (id) => \`/sample/${id}\` }`
  - route `/sample/$id`

- [ ] **Step 1: Write failing tests** (`sample.db.test.tsx`):
  - `/sample` lists seeded items. Typing in "New sample item" and pressing Create adds a row.
  - Opening a row goes to `/sample/<id>` and records a view, so `recents.list` contains the id.
  - Rename + Save updates the heading.
  - After a second client renames the item, saving shows the toast `Changed elsewhere — reloaded` and the field shows the server title.
  - A rename from a second client (through `api.client(token)`) appears on the open detail screen without user action, once the harness's `/changes` delivers.
- [ ] **Step 2: Run** `pnpm --filter @dlh/desktop test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** with `@dlh/ui` components (`SectionCard`, `ItemRow`, `TextField`, `Button`, `EmptyState`, `toast`), using layout-only classes. Query keys are `["sample","list"]` and `["sample","item",id]`. Detect a conflict with `err.data?.code === "CONFLICT"`.
- [ ] **Step 4: Run** `pnpm --filter @dlh/desktop test:db && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sample): list, create, open and rename sample items`.

---

### Task 13: End-to-end check, CI and docs

**Files:**
- Create: `apps/desktop/e2e/items.spec.ts`
- Modify: `.github/workflows/ci.yml` (no new steps needed if `pnpm test:db` and `lint` cover it; confirm the `server` job runs desktop `test:db` and the `check` job runs the generator check), `README.md` (commands table: `pnpm gen:modules`; `pnpm db:reset` now seeds), `docs/specs/core-and-shell.md` (Milestone 3 marked done when it is)
- Test: as listed

- [ ] **Step 1: Write the Playwright test** `items.spec.ts`:
  - sign in
  - on `/sample`, create "E2E item"
  - ⌘K, type `e2e`, choose "E2E item" → `/sample/<id>`
  - go Home, ⌘K: "E2E item" is under Recents
  - open it again. In Node, read `dlh.devSessionToken` from `localStorage` via `page.evaluate`, then call `items.rename` against `http://127.0.0.1:8787/trpc` with a `createTRPCClient<AppRouter>`
  - expect the new heading within **2 000 ms** (`toBeVisible({ timeout: 2000 })`)
- [ ] **Step 2: Run** `pnpm --filter @dlh/desktop test:e2e`. Expected: PASS in Chromium and WebKit.
- [ ] **Step 3: Run the whole suite** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db`. Expected: all PASS.
- [ ] **Step 4: Check by hand** with `pnpm db:reset && pnpm dev`: the sample items are seeded, ⌘K finds them, and a rename through a script shows in the Tauri window.
- [ ] **Step 5: Commit** `test: milestone 3 end-to-end; docs and CI`.
