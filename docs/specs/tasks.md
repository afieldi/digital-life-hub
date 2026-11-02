# Tasks — Deep-dive Spec

Nov 2, 2026 · Arek · Draft

## Scope

The first module built on Core. Tasks is the smallest useful module and the first thing you can use every day: capture a task, see what's due, tick it off. It also tests the module contract end to end: a module-owned table and migrations, writes through Core's item writer, `contains` links, search, ⌘K and AI. Part of the [Digital Life Hub overview](../overview.md).

Building it adds three pieces to Core that every later module uses: **operations** (one definition per endpoint that is also a ⌘K action and an AI action), **module migrations**, and a **`deleteWith`** hook.

**In scope**

- The `task` item type and the module's own `tasks` table and migrations
- Subtasks: tasks inside tasks, linked with `contains`, many-to-many
- Due dates as a day or a moment in time, Google Calendar style
- Creating, editing, completing, reopening, rescheduling and reordering tasks
- The Tasks screens: Open, Upcoming, Done and the Detail panel (see the Tasks canvas)
- Quick add with date and priority parsing, and the same parser in ⌘K
- Core operations: `describeOperation` / `implementOperation`, generated ⌘K forms, the AI operation adapter, `ops.undo`
- Core module migrations and the `deleteWith` hook
- Tasks AI: every operation, plus `breakDown`, `rewriteNotes` and `planToday`

**Out of scope**

- Projects: no project chips, filter or field. A `#word` stays in the title
- Repeating tasks and reminders
- Statuses beyond done / not done (In progress and Review come with project boards, as a new column)
- Capture's decision-model and AI tiers, and the shared `CaptureParser` interface ([Command Bar capture](command-bar-capture.md)); the Tasks parser moves behind that interface when it exists
- Turning calendar events into tasks ("what's on my schedule today?"). The due model matches Google Calendar's, so an Events action can create tasks with a `relates` link to the event later
- Moving Core's own routers (`items`, `links`, `search`) and AI actions (`retitle`, `delete`) to operations
- Provider names and AI error copy moving into `@dlh/core` (AI gateway cleanup, tracked separately)

**Done when**

1. A task captured with quick add ("Call the bank today 9am !") lands in the right group with High; ticking and Undo work; a second device sees it within 2 seconds.
2. "What's due Friday?" works typed in ⌘K with no AI, and asked of AI.
3. "Break this into subtasks" works through OpenRouter, Claude Code and Codex, Undo included.
4. You have used it for your real tasks for a few days.

## Packages

```
packages/core     + describeOperation, Due schema, form field kinds, PaletteContext
packages/server   + implementOperation, operationsRouter, ops router (undo), AI operation adapter,
                    deleteWith, module migrations runner, created-item undo
packages/ui       + generated operation form, due field (date + optional time), item search field
packages/db       migrate() takes a migrations table name
modules/tasks     NEW: schema + drizzle/, operations (shared), server.ts, screens, capture parser, AI runners
apps/api          runs Core then module migrations; ai.prepare takes timeZone
apps/desktop      ⌘K builds actions from operations: argument step, generated form, result list
```

Dependencies still point one way: `apps/api` → `modules/*` → `@dlh/server` → `@dlh/db`. Modules still never import `@dlh/db`; their own tables use `drizzle-orm` directly.

## Operations

An operation is one thing a module can do or read. It is the module's tRPC endpoint, a ⌘K action and an AI action, from one definition. Like AI actions, it has two halves.

**Description** (shared by app and server, e.g. `modules/tasks/src/operations.ts`):

```ts
export const reschedule = describeOperation({
  id: "tasks.reschedule",          // module prefix, as AI action ids
  kind: "mutation",                // or "query"
  label: "Reschedule",
  description: "Change only the due date of the task on screen.",
  appliesTo: ["task"],             // as AI actions: types, "*" or "none"
  words: ["move", "postpone", "push"],
  input: z.object({ id: itemId, expectedUpdatedAt, due }),
  subject: (input) => input.id,    // the item this acts on; null for none
  effects: ["updateItem"],
  summary: (input) => `Reschedule to ${formatDue(input.due)}`,
  palette: (ctx) => { /* see ⌘K */ },
  ai: true,
});
```

**Implementation** (server only, in the module's `server.ts`):

```ts
export default defineServerModule({
  id: "tasks",
  itemTypes: ["task"],
  migrations: true,
  deleteWith,
  operations: {
    reschedule: implementOperation(ops.reschedule, {
      run: async (w, input) => ({ result, undo: { id, due: previousDue, updatedAt } }),
      undo: async (w, record) => { /* back to previousDue */ },
      undoRecord: z.object({ ... }),
    }),
    list: implementOperation(ops.list, { run: async (r, input) => rows }),
  },
  aiRunners: [breakDown, rewriteNotes, planToday],
});
```

**Rules**

- **Endpoints.** `defineServerModule` takes `operations` in place of `router`. Each becomes `protectedProcedure.input(desc.input).query()` or `.mutation()`, mounted under the module id (`tasks.reschedule`). Operations are an object with literal keys, so `AppRouter` keeps full tRPC types and screens call `trpc.tasks.reschedule.useMutation()` as today. A type test pins this.
- **Effects apply to every call.** A mutation runs with Core's scoped writer: only the methods its `effects` allow, and only on `subject(input)` unless it declares `writeOtherItems`. This holds for calls from the screens too, not only AI. The module's own table is written through `w.tx`; effects cannot govern it. Queries get a read handle, no writer.
- **New effect `removeLinks`.** Removing a link from the subject. Reversible, so it allows Do.
- **Undo.** A mutation returns `{ result, undo }`. `ops.undo({ id, record })` (a Core router) checks `record` against the operation's `undoRecord` and runs its `undo`. Items a mutation created are recorded by the writer and soft-deleted by Core on undo, before the operation's own `undo` runs. Undo checks `updatedAt` like any write; a task changed since fails with `CONFLICT` "Changed since".
- **`palette` and `ai`** both default to on and are set to `false` to hide an operation from ⌘K or AI. Leave a code comment where the reason isn't obvious.
- **Reads on ⌘K or AI** must return `{ heading, items }`, where `items` are rows with at least an `ItemSummary`. The command bar renders them with no module code.
- **Registration fails** if an operation id lacks its module prefix or repeats, `palette` can't be built (below), or an `appliesTo` type belongs to another module.

Plain routers still work, for Core's routers and the sample module.

## ⌘K

`palette` is one of:

| Value | ⌘K does |
| --- | --- |
| `false` | Not in ⌘K |
| `true` or omitted | A form generated from the input. `id` and `expectedUpdatedAt` come from the item on screen; any other fields become the form. With none left (complete, reopen), ↵ runs it |
| `(ctx) => Input \| null` | Builds the input from the context; `null` shows the row as not ready |
| `{ params, prefill?, toInput }` | `prefill(ctx)` reads what it can into `params`. If that satisfies `params`, ↵ runs; otherwise ↵ opens a form generated from `params` with those values filled, focused on the first missing field. Submit calls `toInput(ctx, params)` |

`PaletteContext` is `{ item?: { id, type, updatedAt }, text, now, timeZone }`: the item on screen, what you typed after the action's name, the time and the device's zone.

**Flow.** Typing matches operations by label and words alongside Jump to. Choosing one enters its argument step; the row shows `summary(input)` ("Reschedule to Fri, Nov 6") once the input is ready. ↵ runs it and shows a toast with Undo. When the input can't be built, ⌘↵ hands the text to AI with this operation already chosen.

**Generated forms** use `@dlh/ui` fields. Supported kinds:

| Schema | Field |
| --- | --- |
| `z.string()` | Text field; `fields.longText()` is a text area |
| `z.enum([...])` | Segmented choice up to 4 options, otherwise a select |
| `z.boolean()` | Switch |
| `fields.due()` | Date picker with an optional time field (`Due`) |
| `fields.item(types)` | Item search through Core `search`, limited to those types |

A field's label is its `.describe()` text. Any other schema in a form fails registration, so a form never renders half-built.

## Module migrations

A module owns its tables and their migrations.

- Schema in `modules/<id>/src/db/schema.ts`, migrations generated by the module's own `drizzle.config.ts` into `modules/<id>/drizzle/`.
- `migrations: true` means the folder `modules/<id>/drizzle`, resolved against `MIGRATIONS_ROOT` (default the repo root).
- `pnpm db:migrate`, `pnpm dev` and `pnpm db:reset` apply Core's migrations, then each module's in registry order. Each module has its own drizzle journal table, `__drizzle_migrations_<id>`, so module histories never interleave.
- A module table refers to `items` by a foreign key written in the migration SQL, so the module never imports Core's tables. It cascades on delete, which is how Core's purge reaches module rows.
- Modules still may not import `@dlh/db`. The lint rule is unchanged.

## `deleteWith`

`defineServerModule({ deleteWith(tx, id) })` returns ids of items to delete and restore together with `id`. Core's `setDeleted` applies them in the same transaction with the same `deleted_at`; restore brings back those with that exact `deleted_at`; purge then removes them together. Optional; modules without it behave as before.

## Data model

A task is a Core `items` row (`type = "task"`) plus one row in `tasks`, written in one transaction.

**Core item**

| Field | For a task |
| --- | --- |
| `title` | The task's title |
| `search_text` | A copy of `notes`, written by Tasks |
| `archived_at`, `deleted_at` | Core's archive and soft delete. The Tasks screens don't archive |

**`tasks`**

| Column | Type | Notes |
| --- | --- | --- |
| `item_id` | uuid, primary key | FK `items(id) on delete cascade` |
| `completed_at` | timestamptz, null | Null means open |
| `due_date` | date, null | Due on a day with no time. Floating: the same day in every zone |
| `due_at` | timestamptz, null | Due at a moment |
| `due_tz` | text, null | IANA zone the time was set in. Only with `due_at` |
| `priority` | text, not null, default `medium` | Check: `medium` or `high` |
| `notes` | text, null | Plain text |
| `sort_key` | text, not null | Fractional key; the server writes it |

Checks: `due_date` and `due_at` are never both set; `due_tz` only with `due_at`.

Indexes: `(due_date)` and `(due_at)`, each where `completed_at is null`; `(completed_at desc)` where `completed_at is not null`.

**`Due`** (in `@dlh/core`, Google Calendar's shape):

```ts
type Due =
  | { date: "2026-11-06" }                                                   // due_date
  | { dateTime: "2026-11-06T09:00:00-08:00", timeZone?: "America/Los_Angeles" } // due_at, due_tz
  | null;
```

**Priority** levels are ordered in code: `medium` < `high`. A new level (`low`, `urgent`) is a migration on the check constraint. Only High shows on rows.

**Relationships** are Core links: parent task → subtask is `contains`. No column holds a parent.

## Rules

**Subtasks**

- A subtask is a task that a task `contains`. It can have several task parents, and projects or notes may contain it too.
- One level: `create` and `addParent` refuse a parent that is itself a subtask, and a task with subtasks becoming a subtask. A deeper link added through Core's `links.add` shows as a count on its parent.
- A subtask with no due date shows only under its parents. One with a due date also shows in that day's group, labelled with its first parent ("in Review vendor contracts", "+1" for each other parent).
- A parent's row shows its subtasks as "2/4 · Next: List questions for legal". A shared subtask counts under every parent; ticking it ticks it everywhere.

**Completing**

- Ticking a subtask that leaves all of a parent's subtasks done returns that parent in `parentsNowDone`; the app offers "All subtasks done. Complete the task?" It never completes the parent itself.
- Completing a parent leaves its subtasks as they are.

**Deleting.** Tasks' `deleteWith` returns the task's subtasks that have no other live task parent. Restoring the parent restores only those deleted with it. Accepted edge: a subtask shared by two parents and deleted with the second does not come back when the first is restored.

**Dates and time zones**

- A day-only task stays on its day everywhere. A timed task is a moment: set for 9:00 in Los Angeles, it shows 12:00 in New York, with "· 9:00 PT" when `due_tz` differs from the device's zone. It may fall on a different day in another zone.
- The app sends its IANA `timeZone` on every list, stats and AI call. The server works out "today", week bounds (weeks start Monday) and each task's `day` in that zone.
- `dueBetween(from, to, timeZone)` turns days into bounds and queries both columns, so each half uses its index:

  ```sql
  where completed_at is null
    and (   due_date >= $from and due_date < $to
         or due_at  >= $fromInstant and due_at < $toInstant)
  ```

- Overdue: `due_date < today` or `due_at` before the start of today. A timed task not done by its time stays under Today until midnight.

**Order.** Within a day, timed tasks first by `due_at`, then any-time tasks by `sort_key`. No date: by `sort_key`. Subtasks by `sort_key`; a shared subtask has one position, shared by its parents.

**Writes.** Every change goes through Core's writer in one transaction; when only the `tasks` row changes, `updateItem` with no fields moves `updated_at` so other devices refresh.

**Search.** `search_text` is `notes`. Subtasks are searchable themselves, so their titles are not copied into the parent.

## Operations (Tasks)

| Operation | Kind | Input | Effects, subject | ⌘K | AI |
| --- | --- | --- | --- | --- | --- |
| `create` | mutation | `{ title, due?, priority?, notes?, parentId? }` | `createItems`, `addLinks`; `parentId` | `{ params, prefill: parseTaskInput }`: "New task Call the bank fri 9am p1" | ✓ |
| `update` | mutation | `{ id, expectedUpdatedAt, title?, due?, priority?, notes? }` | `updateItem`; `id` | "Edit task…", form filled from the task | ✓ |
| `complete` / `reopen` | mutation | `{ id, expectedUpdatedAt }` | `updateItem`; `id` | Runs on ↵ | ✓ |
| `reschedule` | mutation | `{ id, expectedUpdatedAt, due }` | `updateItem`; `id` | "Reschedule friday", or a due form | ✓ |
| `rescheduleMany` | mutation | `{ items: [{ id, expectedUpdatedAt }], due }` | `updateItem`, `writeOtherItems` | ✗ | ✗ |
| `reorder` | mutation | `{ id, expectedUpdatedAt, position: "top" \| "bottom" \| { after: id } }` | `updateItem`; `id` | Top or bottom | ✓ |
| `addParent` | mutation | `{ id, parentId }` | `addLinks`; `parentId` | "Make subtask of…", task search | ✓ |
| `removeParent` | mutation | `{ id, parentId }` | `removeLinks`; `parentId` | Filled when the task has one parent, else a task search; the server refuses a task that isn't a parent | ✓ |
| `due` | query | `{ from, to, timeZone, include?: "open" \| "all" }` | none | "due friday", "due this week" | ✓ |
| `list` | query | `{ view: "open", timeZone }` · `{ view: "upcoming", timeZone, weekOf }` · `{ view: "done", timeZone, cursor? }` | none | ✗ | ✗ |
| `get` | query | `{ id }` | none | ✗ | ✗ |
| `stats` | query | `{ timeZone, weekOf }` | none | ✗ | ✗ |

- `create` with a `parentId` adds the `contains` link; more parents come from `addParent`. `complete` returns `parentsNowDone`.
- `rescheduleMany` is all or nothing: one stale task fails the batch with `CONFLICT`. It backs "Reschedule all" on Overdue. It is off for ⌘K and AI because the model can't see the task list yet; `planToday`'s context could later feed it.
- `list` returns rows with `day` (in the given zone) and a subtask summary `{ total, done, next }`; the app groups them. Done pages by `completed_at`.
- `stats` returns completions per day, completed on or before the due day, overdue tasks completed, and this week against last.
- `get` returns the task, its subtasks and its parents. Other links come from Core's `links.forItem`.
- Delete and restore are Core's `items.delete` / `items.restore`, with `deleteWith`.
- Errors as Core: `CONFLICT`, `NOT_FOUND`, `BAD_REQUEST` (invalid `due` or zone, a parent that isn't a task, a subtask as a parent).

## Quick add

`parseTaskInput(text, { now, timeZone })` in `modules/tasks/src/capture.ts`: a pure function on every keystroke, in the app, offline.

| Pattern | Example | Becomes |
| --- | --- | --- |
| Date (`chrono-node`) | today, fri, next tue, Nov 6 | `{ date }` |
| Date and time | tomorrow 10am, fri 9:30 | `{ dateTime, timeZone }` in the device's zone |
| `p1`, `p2` | p1 | High, Medium. Whole word, any case. `p0` and `p3` reserved for later levels |
| A lone `!` | Call the bank ! | High. Only as its own word; "Call Mum!" stays in the title |
| Everything else | Call the bank #home | Title, `#word` included |

It returns the fields and the spans it read, so the field highlights them; backspacing into a highlighted span turns it back into text. `parseDue(text, ctx)` is the date half, used by `reschedule` and `due`.

## AI actions

**From operations.** The adapter turns each `ai` operation into an AI action:

- The model fills the input except `id` and `expectedUpdatedAt`, which come from the item on screen. `subject(input)` must be the item on screen or null (creating a task with no parent), unless `writeOtherItems` is declared.
- The cap comes from `effects` as for any AI action: mutations here can Do with Undo; queries are Ask, their result shown as rows, with no second model call.
- `fields.item` values are filled with a title. The server matches it with `search`, limited to the field's types: one clear match runs; an ambiguous one or none drops to Suggest with the top three matches.
- Undo is the operation's own, through `ai.undo`.

**Hand-written runners**

| Action | Applies to | Kinds | Effects | Does |
| --- | --- | --- | --- | --- |
| `tasks.breakDown` | `task`, top level | Suggest, Do | `createItems`, `addLinks` | From the title, notes and existing subtasks, proposes 3–7 subtask titles. Suggest shows a checklist and creates those you tick; Do creates all. On a subtask: "Subtasks can't have subtasks" |
| `tasks.rewriteNotes` | `task` | Suggest, Do | `updateItem` | Rewrites the notes more clearly without adding facts. Suggest offers two versions; Do replaces them. Undo restores the old text |
| `tasks.planToday` | `"none"`, `"*"` | Ask | none | Context: overdue, today's and the next two days' open tasks (title, due, priority, subtask progress), at most 60. Answers with an ordered list of `{ taskId, reason }` and one line of advice, shown as task rows. Ids outside the context are rejected |

**Time.** `ai.prepare` takes `timeZone`; every task action's context starts with "Today is Mon, Nov 2, 2026 (America/Los_Angeles)".

**Created items.** No Core AI action creates items today; `breakDown` and `create` are the first. The writer records every item created, and Undo soft-deletes exactly those (Core does it, since the runner's writer has no delete). `addLinks` still starts only from the item on screen, so new subtasks can only go under the task you're on.

**Registration.** Operations can't drift between app and server, since both import one description. For the hand-written runners, a module test checks the manifest's `aiActions` and the server's `aiRunners` list the same ids.

**Interpreter.** `modules/tasks/test/ai-phrasings.ts` holds at least 8 phrasings per action, including near-misses between the actions that all "change this task": `reschedule` (only the due date), `rewriteNotes` (only the notes), Core's `retitle` (only the title) and `update` (priority, or several fields). The shared test requires 90%.

## Screens

The Tasks canvas (Dusk design system) holds the designs. Every screen has a breadcrumb and the dock.

**Open** (`/tasks`)

- Quick add at the top, highlighting what `parseTaskInput` read.
- Groups: Overdue (with "Reschedule all", to today), Today, This week, Later (only when non-empty) and No date. Tasks done today stay in Today, struck through, until midnight.
- Rows: checkbox, title, when ("12:00 · 9:00 PT" when zones differ), High flag, subtask summary, "in \<parent>" on dated subtasks, linked-note count.
- Side column: Today's progress, "Next up at …", a High-only switch, and the keys N (new task), X (complete), ↵ (open).

**Upcoming** (`/tasks/upcoming`)

- Seven days, Monday first, with previous and next week. Each day has Add (quick add with that day filled in). Dragging a card to another day runs `reschedule`.
- Later: tasks after the week.

**Done** (`/tasks/done`)

- "Today is clear" when nothing open is due today; done tasks grouped by the day they were completed, with Undo; paged.
- Side column from `stats`: completions per day this week, on time, overdue cleared.

**Detail** (`/tasks/$id`, the task type's `href`)

- A panel over the list you came from; Esc closes it. Records the view for Recents.
- Checkbox and title; Due (date, optional time); Priority (Medium / High); "Subtask of" chips with × (`removeParent`) and "+ Add to task…" (`addParent`); Subtasks (add new, add existing, tick, drag to reorder); Notes (plain text, saved as you type after a short pause); Linked; created and edited footer.
- ⋯ lists the task's ⌘K operations and AI actions.

**States.** Empty: Open "Nothing open. Add one above"; Upcoming's empty days dashed; Done "Nothing done yet". Loading: skeleton rows. Error: `EmptyState` with Retry. A conflicting write refetches and shows a toast.

**Canvas changes.** Detail shows Subtasks instead of Steps and Medium / High; project chips, filter and field come out; the zone label is added to rows.

## Testing

- **Unit:** `parseTaskInput` and `parseDue` (relative dates, times, `p1`/`p2`, lone `!`, "Mum!" untouched, `#word` kept, spans, the device's zone); `day` and grouping around midnight, Monday and daylight-saving changes, and a timed task changing day across zones; ordering; reorder positions to keys; operation registration (defaults, prefixes, unbuildable palettes); the form generator for every field kind, and unsupported schemas failing; ⌘K argument step, form fallback and the `{ heading, items }` result list.
- **Types:** `AppRouter` exposes each Tasks operation with its exact input and output.
- **Database (`test:db`):** module migrations (Core first, separate journals); purge cascading to `tasks`; `deleteWith` (only subtasks with no other live parent; restore by matching `deleted_at`); subtask rules; `parentsNowDone`; `rescheduleMany` all or nothing; every write moves `updated_at` and publishes a change (Core's module contract test); effects enforced on screen calls; `dueBetween` uses its indexes over 10,000 tasks (`EXPLAIN`).
- **Undo:** one shared test runs every mutation, then `ops.undo`, and checks the state matches before; created items are soft-deleted.
- **AI** (fake provider): each runner and its Undo; item matching runs on one match and suggests on several; `planToday` rejects unknown ids; the 12 actions meet the 90% gate.
- **End to end (Playwright):** quick add "Call the bank today 9am !", see it under Today with High, tick it, Undo; ⌘K "Reschedule friday" on an open task; "Make subtask of…", pick a task, see it nested; "due friday" in ⌘K lists it; drag a card to another day in Upcoming; a script completes a task through the API and the open screen updates within 2 seconds.

## Build order

One milestone, one PR, built in this order so each step is testable alone:

1. Core: module migrations and `deleteWith`.
2. Core: operations (`describeOperation`, `implementOperation`, `operationsRouter`, `ops.undo`, `removeLinks`, `Due`, field kinds) and the type test.
3. Tasks server: schema and migration, every operation, `dueBetween`, database tests.
4. Core: ⌘K (actions from operations, argument step, generated forms, result list) and AI (operation adapter, item matching, created-item undo, `timeZone` in `ai.prepare`).
5. Tasks screens: Open, Upcoming, Done, Detail, quick add, states.
6. Tasks AI: `breakDown`, `rewriteNotes`, `planToday`, phrasings.
7. End to end, docs, and the manual Done check.

Steps 1, 2 and 4 are Core work, roughly as large as Tasks itself.

## Decisions

- **Subtasks are tasks linked with `contains`, many-to-many.** Core already gives nesting, search, membership and sync. A parent's delete takes only subtasks no other live task holds.
- **Due follows Google Calendar: a floating date, or an instant with an optional zone.** "Any time Friday" stays Friday everywhere; a 9:00 call happens at the same moment everywhere; events map one to one.
- **Each module owns its migrations,** with its own journal, applied after Core's.
- **Operations define endpoints.** One description is the tRPC endpoint, the ⌘K action and the AI action; ⌘K and AI are on unless set to `false`. Reads are operations too.
- **Priority is a scale, `medium` and `high`,** so levels can be added. Quick add uses `p1`/`p2` and a lone `!`.
- **Order lives in the module (`sort_key`),** so Core links stay unordered.
- **Notes are module data.** `search_text` is only a copy for search.
- **Weeks start Monday.**
- **All four screens ship together.**

## Open questions

None blocking. The canvas edits listed under Screens are pending.
