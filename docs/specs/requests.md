# Queue — Deep-dive Spec

Nov 2, 2026 · Arek · Draft

## Scope

One place for things that need you: someone asked for something, a message mentions you, or you filed a reminder to deal with later. Each request is reviewed once and ends in an outcome: it becomes a task, you handled it, or it wasn't for you. Part of the [Digital Life Hub overview](../overview.md).

The queue is the landing place for work sources. Slack intake, notifications and a Slack bot come next, each with its own spec; they all file requests through the same `requests.file` operation this module defines. The queue works on its own before any of them exist: you file by hand in ⌘K, or ask AI to.

**In scope**

- The `request` item type and the module's own `requests` table and migrations
- Filing a request from ⌘K, from AI, and from any later source through one operation, safe to retry
- Resolving a request: Make task, Handled, Not for me; Reopen as Undo
- The Queue screens: Open, Resolved and the Detail panel
- A declared Home widget, "Needs you", rendered once Home exists

**Out of scope**

- Slack intake, notifications and the Slack bot (next specs, see the overview's build order)
- Snooze, attaching a request to an existing task, and urgency. Requests are ordered by arrival only
- A People model. Senders are fields on the request
- An AI runner that suggests an outcome. It comes with Slack intake, trained on `not_for_me` decisions
- The Home screen itself and the `HomeWidget` contract (Home spec)

**Done when**

1. A request filed in ⌘K shows in Queue; Make task creates a linked task and moves the request to Resolved.
2. Not for me, then Undo, puts the request back in Open, on a second device within 2 seconds.
3. Filing twice with the same `source` and `externalId` gives one request.
4. "What's waiting on me?" lists open requests in ⌘K with no AI, and asked of AI.

## Packages

```
modules/requests  NEW: schema + drizzle/, operations (shared), server.ts, screens
packages/ui       + --color-type-request token
apps/desktop      Make task flow (task form prefilled from a request, then resolve)
```

No Core changes. Queue is built from what Tasks added: operations, module migrations and `deleteWith`.

## Data model

A request is a Core `items` row (`type = "request"`) plus one row in `requests`, written in one transaction.

**Core item**

| Field | For a request |
| --- | --- |
| `title` | A one-line summary of what is asked. Core's title rules: trimmed, never empty |
| `search_text` | `body` and `from_name`, written by the module |
| `archived_at`, `deleted_at` | Core's archive and soft delete. The Queue screens don't archive |

**`requests`**

| Column | Type | Notes |
| --- | --- | --- |
| `item_id` | uuid, primary key | FK `items(id) on delete cascade` |
| `body` | text, null | The quoted message or details. Plain text |
| `from_name` | text, null | Who it is from, as shown. Null when you filed it yourself |
| `source` | text, not null | Check: `manual`, `ai`, `slack`. A new source is a migration on the check constraint |
| `source_handle` | text, null | The sender's id at the source (a Slack user id) |
| `source_url` | text, null | A link back to the original message |
| `external_id` | text, null | The message's id at the source |
| `received_at` | timestamptz, not null | When it was sent at the source; defaults to filing time |
| `resolved_at` | timestamptz, null | Null means open |
| `outcome` | text, null | Check: `task`, `handled`, `not_for_me`. Set exactly when `resolved_at` is |

Checks: `outcome` and `resolved_at` are both null or both set; `external_id` is null when `source = 'manual'`.

Indexes: unique `(source, external_id)` where `external_id is not null`; `(received_at)` where `resolved_at is null`; `(resolved_at desc)` where `resolved_at is not null`.

**Relationships** are Core links: a request resolved as a task `relates` to that task. No column holds the task id.

**Senders.** `from_name` and `source_handle` are enough to filter "everything from Maya". A People module can match on `source_handle` later without a migration here.

## Operations (Queue)

| Operation | Kind | Input | Effects, subject | ⌘K | AI |
| --- | --- | --- | --- | --- | --- |
| `file` | mutation | `{ title, body?, fromName?, source?, sourceHandle?, sourceUrl?, externalId?, receivedAt? }` | `createItems` | "File a request", form: title, details, from | ✓ |
| `resolve` | mutation | `{ id, expectedUpdatedAt, outcome, taskId? }` | `updateItem`, `addLinks`; `id` | "Handled", "Not for me" on the request on screen | ✓, `handled` and `not_for_me` only |
| `reopen` | mutation | `{ id, expectedUpdatedAt }` | `updateItem`, `removeLinks`; `id` | Runs on ↵ | ✗ |
| `open` | query | `{}` | none | "waiting on me", "queue" | ✓ |
| `resolved` | query | `{ outcome?, cursor? }` | none | ✗ | ✗ |
| `get` | query | `{ id }` | none | ✗ | ✗ |

- `source` defaults to `manual` in ⌘K and `ai` when filed through AI. Later sources call `file` from the server.
- `file` with a `(source, externalId)` pair that exists returns that request with `existing: true` and writes nothing. Two concurrent calls with the same pair give one row (the unique index decides; the loser reads the winner).
- `resolve` with `outcome: "task"` needs `taskId`, a live item of type `task`, and adds the `relates` link in the same transaction. Other outcomes refuse a `taskId`.
- `resolve` on a resolved request: the same outcome is a no-op; a different one is `CONFLICT`.
- `reopen` clears `outcome` and `resolved_at`, and removes the `relates` link it added. The task stays. It is `resolve`'s Undo, and its own Undo resolves again with the old outcome and task.
- `open` returns open requests, oldest `received_at` first, as `{ heading, items }` for ⌘K and AI. `resolved` covers the last 30 days, newest `resolved_at` first, paged.
- `get` returns the request and its task, if any. Other links come from Core's `links.forItem`.
- Delete and restore are Core's `items.delete` / `items.restore`. Queue has no `deleteWith`: deleting a request never deletes its task. Deleting the task leaves the request resolved, and its detail shows "Task deleted".
- Errors as Core: `CONFLICT`, `NOT_FOUND`, `BAD_REQUEST` (empty title, `externalId` with `source: "manual"`, an outcome and `taskId` that don't match).

**Make task** is two calls made by the app, so Queue never writes the Tasks table: the task form opens prefilled (title from the request, body as notes), submit runs `tasks.create`, then `requests.resolve` with the new `taskId`. If the second call fails, the task exists and the panel shows "Task created, not linked · Link task", which retries `resolve`. AI can't make a task from a request in v1, since one AI request runs one action; ⌘K "Make task" opens the same flow.

## AI actions

Every Queue operation marked ✓ is an AI action through the operation adapter. Phrasings: "file this", "remind me to look at…", "what's waiting on me?", "handled", "done with this", "not for me", "ignore this". No runners in v1.

## Screens

**Queue (`/queue`)**

- View tabs: Open and Resolved, the tab in the URL.
- Open: oldest first. Each row shows the source glyph, `from_name` (or "You"), the title, a one-line body preview and its age ("2h", "3d").
- Row actions on hover or focus: Make task (`t`), Handled (`h`), Not for me (`n`). Resolving removes the row with an Undo toast, which runs `reopen`.
- Resolved: outcome chip on each row; a task outcome links to the task. Filter by outcome with removable chips.

**Detail (side panel)**

- Full body, sender, received time, Open in Slack (any `source_url`), and the three outcomes at the bottom.
- Resolved: the outcome, the task chip (or "Task deleted") and Reopen.
- Opens from a row or ⌘K Jump to; Esc closes it. Records the view for Recents.

**Shell**

- Nav slot "Queue", `g q`. The open count shows as a quiet number beside it, only when above 0.
- Item type colour `--color-type-request`, chosen in the design pass to stand apart from the five existing colours.

**Home widget.** The manifest declares `homeWidgets: [needsYou]`: the open count and the three oldest requests with their outcome actions. It renders once Home exists; Home's spec defines `HomeWidget`, and this is its first user.

**States.** Empty: Open "Nothing waiting on you"; Resolved "Nothing resolved yet". Loading: skeleton rows. Error: `EmptyState` with Retry. A conflicting write refetches and shows "It changed elsewhere; try again".

## Testing

- **Unit:** input rules (source and `externalId`, outcome and `taskId`); the age label.
- **Database (`test:db`):** concurrent `file` with one external id gives one row; `resolve` no-op and `CONFLICT`; the `relates` link written with the outcome in one transaction and removed by `reopen`; deleting the task leaves the request resolved; `open` order and the 30-day `resolved` window; every write moves `updated_at` and publishes a change (Core's module contract test).
- **Undo:** the shared operation Undo test covers `file`, `resolve` and `reopen`.
- **AI** (fake provider): `file` and `resolve` through the gateway with Undo; "what's waiting on me?" lists open requests; `resolve` refuses `task` from AI; the actions meet the 90% gate.
- **End to end (Playwright):** file in ⌘K, see it in Open, Make task, the task exists and links back, the request is in Resolved; Not for me then Undo puts it back; a script files a request through the API and the open screen updates within 2 seconds.
- **Screenshots:** an Open row, the empty state, the detail panel open and resolved.

## Build order

One milestone, one PR:

1. Server: schema and migration, every operation, database tests.
2. Screens: Open, Resolved, Detail, states, nav slot.
3. Make task flow in the app.
4. AI phrasings, end to end, the declared Home widget, docs, and the manual Done check.

## Decisions

| Topic | Decision |
| --- | --- |
| Item model | A request is its own type; review ends it in an outcome, and the request stays as the record |
| Outcomes | Make task, Handled, Not for me. Not for me is kept apart from Handled so Slack intake can learn from it |
| Senders | Fields on the request, no People model |
| Order | By arrival. No urgency in v1 |
| Sources | One `file` operation for every source, idempotent on `(source, external_id)` |
| Make task | Composed in the app from `tasks.create` and `requests.resolve`; modules don't write each other's tables |

## Open questions

- [ ] The request colour token's value (design pass).
- [ ] Whether Resolved needs more than 30 days once Slack fills the queue.
