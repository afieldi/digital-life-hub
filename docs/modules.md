# Adding a module

A module (Tasks, Requests, Notes…) lives in `modules/<id>` and plugs into the app with no edit outside its folder. The shell finds its manifest, the API finds its server module, and both come from one description.

## Start from the scaffold

```bash
pnpm new:module notes note --label Notes --key n
pnpm install && pnpm gen:modules
```

This writes a working module: a `notes.create` operation (in ⌘K as "New note"), a Dock entry and `g n`, a page listing notes, and a DB test. `pnpm dev` shows it at once.

## The three files

| File | Holds | Imports |
| --- | --- | --- |
| `src/module.ts` | `describeModule({ id, itemTypes, operations, aiActions })`: what the module is and does | `@dlh/core` only |
| `src/manifest.tsx` | `defineModule(desc, { itemType, nav, routes, homeWidgets? })`: its client half | React, `@dlh/ui`, `@dlh/client` |
| `src/server.ts` | `defineServerModule(desc, { operations, migrations?, seed?, aiRunners?, deleteWith? })`: its server half | `@dlh/server` |

- The **id** is the folder name (a test checks), the route prefix of its procedures (`notes.create`) and the prefix of its operation ids.
- **Item types** are the only values `items.type` may hold for it; the API refuses others.
- `defineServerModule` must implement **exactly** the described operations: a missing or extra one is a compile error.
- `apps/desktop/test/moduleParity.test.ts` and `scripts/module-ids.test.ts` check the two halves agree, with no list to update.

## Operations

An operation (`describeOperation` in `src/operations.ts`) is one thing the module can do or read. It becomes, at once, a tRPC procedure, a ⌘K action, and an AI action (unless `ai: false`).

- `input` is a zod object. Writes on an item take `id` and `expectedUpdatedAt`, so a stale write conflicts instead of overwriting.
- `effects` lists what it may write (`createItems`, `updateItem`, `addLinks`…). The writer it gets refuses anything else.
- `palette` says how ⌘K builds the input: a form (the default), a function of what's on screen (throw `NotReady` from `itemOnScreen(ctx)` until it can), or `false`.
- `summary` is the toast after it runs; Undo comes from the mutation's `undo`, and Core removes items it created.

## Writing data

- Change items through the writer an operation gets (`w.createItem`, `w.updateItem`…), never `@dlh/db` (lint refuses it). The writer checks versions, publishes changes for live refresh, and keeps search and recents right.
- A table of the module's own: put its schema in `src/db/schema.ts` with a `drizzle.config.ts` like Tasks', run `pnpm --filter @dlh/module-<id> generate`, then **add by hand** to the SQL a foreign key `item_id → items(id) ON DELETE CASCADE`. Set `migrations: true`. `apps/api/test/module-tables.db.test.ts` fails if a key to `items` doesn't cascade.
- `seed(w)` writes sample data. `pnpm dev` runs it once, the first time the module has no items, even on a database other modules already seeded.

## Screens

- `useModuleApi<NotesRouter>("notes")` for the module's procedures, `useCoreApi()` for Core's (`items.list`, `items.rename`, links, search).
- `useModuleWrite({ queryKeys, conflictMessage })` runs a write with its toast, Undo, refresh and conflict handling. `apiErrorKind(err)` says what went wrong (`conflict`, `gone`, `invalid`, `network`…); queries already retry only what may pass.
- An item page calls `useRecordView(id)`: it records the view for Recents and tells ⌘K and AI which item is on screen. Point `itemType.href` at it.
- Modules use `@dlh/ui` components and layout classes only; `scripts/check-module-classes.ts` refuses colour, type and other visual classes.
- A panel for Home goes in `homeWidgets: [{ id, label, component, order? }]`.
- Days, zones and dues: `todayIn`, `dayOfDue`, `formatWhen`, `timeZoneValue` and the rest are in `@dlh/core`; `parseDue` in `@dlh/core/capture`.

## Settings and secrets

A module never reads `process.env` (lint refuses it). It declares what it needs in `server.ts`, and the API checks it at start with its own settings:

```ts
defineServerModule(eventsModule, {
  operations: { ... },
  config: {
    prefix: "EVENTS_",
    schema: z.object({ ICS_URL: z.url(), TIMEOUT_MS: z.coerce.number().default(5000) }),
  },
});
```

Each key is the variable `EVENTS_ICS_URL` and so on; list them in `apps/api/.env.example` (a test checks). An operation reads them with `configFor(deps, eventsServer)`.

## AI

Operations are AI actions on their own, run by Core. A hand-written action goes in the description's `aiActions`, with its runner in `aiRunners` on the server. The dev and e2e fake answers each action from its output schema.

## Tests

- Server: `const { caller, deps } = testServer(db, [notesServer])` on `freshModuleDb([notesServer])` (see the scaffold's `test/create.db.test.ts`).
- Desktop: `signedInApp(path, { db })` renders the real app with every module.
- Core features that need some item and module, not yours, use the fixture module (`signedInApp(path, { fixture: true })`, `createTestApi({ modules: [fixtureServer] })`).

## Checklist

- [ ] `module.ts`, `manifest.tsx` and `server.ts` derive from one `describeModule`.
- [ ] Every write goes through an operation and the writer; every table keyed by `item_id` cascades.
- [ ] Item page records views; screens use `@dlh/ui` and `useModuleWrite`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db` pass.
