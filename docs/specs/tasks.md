# Tasks — Deep-dive Spec

Nov 1, 2026 · Arek · Draft

## Scope

The first module built on Core. Tasks is the smallest useful module and the first thing you can use every day: capture a task, see what's due, tick it off. It also tests the module contract end to end: a module-owned table, writes through Core's item writer, `contains` links, search, and AI actions.

**In scope**

- The `task` item type and the module's own `tasks` table
- Subtasks: tasks inside a task, linked with `contains`
- Creating, editing, completing and reopening tasks, with due dates and times
- The Tasks screen: Open, Upcoming and Done, and the Detail panel (see the Tasks canvas)
- Quick add at the top of the list and ⌘K "New task"
- Tasks AI actions: break into subtasks, rewrite notes, reschedule

**Out of scope**

- Projects and project boards (the Projects module). Tasks shows a project chip when a project item `contains` the task, but nothing here creates projects
- Repeating tasks (the `repeat` column is reserved, not used)
- Natural-language capture ("tomorrow 10am #q4"): see [Command Bar capture](command-bar-capture.md)
- Reminders and notifications
- Statuses beyond done / not done (In progress, Review come with project boards)

**Done when** a task created from quick add with a due date shows under Today, can be broken into subtasks by AI with Undo, is completed from the list, and the change shows on a second device within 2 seconds.

## Screens

The Tasks canvas (Dusk design system) holds the designs: **Open**, **Upcoming**, **Detail panel** and **Done**.

- **Open:** quick add at the top; groups Overdue, Today, This week, No date; each row has a checkbox, title, due date or time, linked-note count, a High flag and a project chip. A side column shows today's progress and project filters.
- **Upcoming:** a seven-day view with an Add button per day, then a Later list.
- **Detail panel:** title, Due, At, Project, Priority, Repeat (disabled in v1), **Subtasks**, Notes and Linked items.
- **Done:** "Today is clear" when nothing is due today; finished tasks by day with Undo; completions per day this week.

Every screen also needs its empty, loading and error states; those follow `EmptyState` and the existing patterns.

## Data model

A task is a Core `items` row (`type = "task"`) plus one row in the module's `tasks` table, written in the same transaction through Core's writer.

**Core item** (owned by Core)

| Field | For a task |
| --- | --- |
| `title` | The task's title |
| `search_text` | Derived by Tasks from `notes`, so search finds a task by its notes |
| `archived_at`, `deleted_at` | Core's archive and soft delete |

**`tasks`** (owned by the Tasks module)

| Column | Type | Notes |
| --- | --- | --- |
| `item_id` | uuid, primary key | References `items.id`, cascade on purge |
| `completed_at` | timestamptz, null | Set when ticked; null means open |
| `due_date` | date, null | Null means no date |
| `due_time` | time, null | Only with a `due_date`; null means any time that day |
| `priority` | text | `normal` or `high` (see Open questions) |
| `notes` | text, null | The task's description |
| `sort_key` | text | Manual order within a list or a parent; fractional key so a move writes one row |
| `repeat` | text, null | Reserved for repeating tasks; unused in v1 |

**Subtasks.** A subtask is an ordinary task: its own item, its own `tasks` row, and a `contains` link from its parent. There is no separate steps table. This reuses Core's loop prevention, search, recents, sync, and membership: a project that contains a task also contains its subtasks through `listContained`.

**Relationships** use Core links, never columns: project → task is `contains` (set by the Projects module); "this task came from a note" is a link with a short context.

## Rules

**Lists show top-level tasks.** A task with a `contains` parent that is also a task is a subtask. In lists:

1. A subtask without its own due date appears only under its parent, summarised on the parent's row as progress ("2/4") and the next open subtask ("Next: List questions for legal").
2. A subtask with its own due date also appears in that date's group, with its parent as a small label ("in Review vendor contracts").
3. The screens show one level of nesting in v1. The data allows deeper trees; deeper subtasks show as a count on their parent.

**Completing.**

- Ticking the last open subtask offers "All subtasks done. Complete the task?" with Complete as an action; it never completes the parent on its own.
- Completing a parent leaves its open subtasks as they are; reopening the parent shows them again.
- Undo on completion restores `completed_at` to null.

**Dates.** Overdue means `due_date` before today and not completed. Today, This week and Upcoming use the device's local date. `due_time` without `due_date` is refused.

**Order.** Open lists sort by due date, then due time (any-time last within a day), then `sort_key`. Subtasks sort by `sort_key`. Dragging a task writes only its own `sort_key`.

**Writes.** Every change to a task, its `tasks` row included, goes through Core's writer in one transaction (`updateItem` with no fields when only the `tasks` row changes), so `updated_at` moves and other devices refresh.

**Search.** `search_text` is `notes` as plain text. Subtasks are searchable themselves, so their titles are not copied into the parent.

## API

A `tasks` router (mounted as `tasks`):

| Procedure | Input | Notes |
| --- | --- | --- |
| `tasks.create` | `{ title, dueDate?, dueTime?, priority?, notes?, parentId? }` | With `parentId`, also adds the `contains` link |
| `tasks.update` | `{ id, expectedUpdatedAt, title?, dueDate?, dueTime?, priority?, notes? }` | Conflicts as Core's writer |
| `tasks.complete` / `tasks.reopen` | `{ id, expectedUpdatedAt }` | |
| `tasks.move` | `{ id, expectedUpdatedAt, sortKey, parentId? }` | Reorder, or move under another task |
| `tasks.list` | `{ view: "open" \| "upcoming" \| "done", from?, to? }` | Top-level tasks with subtask summaries |
| `tasks.get` | `{ id }` | Task, its subtasks and linked items |

Shared Zod schemas live in the module's shared file so the screens and the server use the same types.

## AI actions

Tasks registers these with the AI gateway (descriptions in the shared file, runners in `server.ts`):

| Action | You say | Kinds | Effects |
| --- | --- | --- | --- |
| `tasks.breakDown` | "break this into subtasks" | Suggest, Do | `createItems`, `addLinks` (subtasks under this task) |
| `tasks.rewriteNotes` | "make the description clearer" | Suggest, Do | `updateItem` (this task's notes) |
| `tasks.reschedule` | "move this to Friday" | Suggest, Do | `updateItem` (this task's dates) |

Each has a plain description, labelled phrasings in `modules/tasks/test/ai-phrasings.ts`, and Undo. Core's `retitle`, `answer` and `delete` apply to tasks unchanged.

**Before these land** (carried from the AI gateway review):

- The scoped writer must tie created items to the current item (today `createItems` allows any create).
- A check that the action ids in the module's manifest and its server registration match.
- Provider names and error copy move into `@dlh/core`, shared by server and app.

## Testing

- **Unit:** date grouping (Overdue, Today, This week, No date) around midnight and week boundaries; ordering; the subtask display rules; `sort_key` generation.
- **Database:** every write moves `updated_at` and publishes a change (Core's module contract test); create with `parentId` links the subtask; completing the last subtask does not complete the parent; a subtask with a date appears in both places; conflicts on stale `expectedUpdatedAt`.
- **AI:** each action through the gateway with the fake provider, Undo included; phrasings meet the 90% interpreter gate.
- **End to end:** quick add a task due today, see it under Today, tick it off, Undo; break a task into subtasks and tick one.

## Open questions

- [ ] **First version scope.** Recommended: Open and the Detail panel first, with Upcoming and Done in a second pass. Or all four screens at once?
- [ ] **Priority.** Normal and High (as the list rows show), or Low, Normal and High (as the Detail panel shows)?
- [ ] **Status.** Only done / not done for now (recommended), or store a status ready for project boards?
- [ ] **Week start.** Monday or Sunday for "This week" and Upcoming?
- [ ] **Projects before Projects.** Should Tasks let you pick a project before the Projects module exists, or hide the project field until then?

## Decisions

- **Subtasks are tasks linked with `contains`, not a separate steps concept.** Core already provides nesting, loop checks, search, membership and sync; a second concept would duplicate it. Display rules keep lists calm.
- **Due date and optional time, not a single timestamp.** "Any time today" is common and a timestamp can't say it.
- **Order lives in the module (`sort_key`),** so Core links stay unordered.
- **The body is module data.** `notes` lives in `tasks`; `search_text` is only a derived copy for search.
