# Agent Hub, Part 1: Gateway Check, Core and the Agent Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build steps 1–3 of the Agent Hub build order: the throwaway Gateway check, then the Core pieces the agent needs (service tokens, Undo of called operations, detail panels, `touchItem`), then the server half of `modules/agent` with `tasks.assignee`. When this lands, runs can be assigned, claimed, suspended, decided, finished and failed through the API, with database tests, but no container runs them yet.

**Architecture:** Core learns two non-person principals: the worker and a run. Both are checked by the same tRPC context and `/changes`. An operation's `access` says who may call it. Undo tokens keep each called mutation's undo record, so `ops.undo` reverts a whole call tree in one transaction. `modules/agent` owns its tables and reaches Tasks and Queue only through operation calls. The worker drives a run's life through worker-only operations, and the heartbeat is how the worker learns that a run should stop.

**Tech Stack:** TypeScript, Zod 4, tRPC 11, Drizzle + Postgres, Hono SSE, Vitest; for the check only, Docker and `@anthropic-ai/claude-agent-sdk`.

**Spec:** `docs/specs/agent-hub.md` (agreed Nov 4, 2026). Read it with `docs/modules.md` (how a module is built) and `docs/superpowers/plans/2026-11-02-queue.md` (how operation calls were added).

**Later plans:** Part 2 covers `apps/agent` and `packages/agent-runner` (build steps 4–5) and is written after Task 1's findings are in. Part 3 covers the screens, end-to-end tests and the Done check (steps 6–7).

**Decisions made while planning**

Task 2 writes each of these back into the spec.

- **Who may call an operation.** `OperationDescription.access?: "everyone" | "user" | "worker"`.
  - When left out, it is `"everyone"` if `ai !== false` and `"user"` otherwise.
  - `everyone` means you or a run. `user` means only you. `worker` means only the worker token.
  - `describeOperation` refuses `access: "worker"` unless `palette: false` and `ai: false` are both set.
  - Operation calls skip the access check: a callee runs as its caller already ran.
  - Agent's own AI-callable operations set `access: "user"`, so a run can't start, cancel or reassign runs. That is the spec's "a run token may not call `agent` operations".
- **Context.** `Context` keeps `session` (yours, unchanged for existing code) and gains `principal: Principal | null`, defined as `{ kind: "user"; session: Session } | { kind: "worker"; tokenId: string } | { kind: "run"; tokenId: string; runId: string }`. `protectedProcedure` stays person-only.
- **Undo order.** The spec's order holds: the caller's undo, then the callees' undos in reverse, then deleting the created items.
  - Make task still works under it: `tasks.create`'s undo is a no-op, and reopening the request doesn't need the task deleted first.
  - A caller must not touch an item after a callee updated it in the same mutation, or the callee's undo conflicts. So `assign` doesn't `touchItem` the task, because `setAssignee` already bumped it.
- **`touchItem` needs an effect.** The new `AiEffect` `"touchItems"` allows `w.touchItem(id)` on any live item. It is not one of the effects AI may run without asking first.
- **Operation names are flat.** An operation's id is `<module>.<key>`, so the spec's `connections.list` and the like become `agent.connections`, `agent.setDefaultConnections`, `agent.disableConnection`, `agent.registerConnection`, `agent.settings` and `agent.setSettings`.
- **What a run is waiting on.** `agent_runs.waiting_on` is replaced by `pending` and `decision`, both jsonb.
  - `pending` is `{ requestId, seq, kind: "approval" | "grant" | "failure", connectionId?, tool?, inputHash? }`: the open request the run filed.
  - `decision` is `{ seq, approve }`. It is set by `decide` and cleared by the `claim` that delivers it.
  - `decide`'s input is `{ runId, seq, approve }`. The request is known only after it is filed, so a request's actions name the event `seq` instead of the request id.
- **Cancelling a run when its task changes.** `heartbeat` returns `{ stop: boolean }`. It sets the run to `cancelled` and returns `stop: true` when the task is completed, deleted or no longer assigned to the agent. This needs no hook from Tasks into Agent. A queued or waiting run whose task changed is cancelled by the next `claim`.
- **Sweeps happen in `claim`.** Before choosing a run, `claim` does two things. Running runs with no heartbeat for 2 minutes go back to `queued`, and their tokens are revoked. Events of runs that ended more than 30 days ago are deleted.
- **Claims are serialised.** `claim` first takes `pg_advisory_xact_lock(hashtext('agent.claim'))`, so the parallel limit can't be overshot.
- **"Due by now" needs a time zone.** `agent_settings.time_zone` (default `UTC`) is used to read all-day due dates. Settings → Agent sets it in Part 3.
- **Retry from a failure request.** `agent.retry` declares `calls: [requestOps.resolve]` and resolves the run's open failure request as `handled`. That is what `requests.file` requires of an action's operation.

## Global Constraints

- Run statuses: `queued`, `running`, `waiting`, `done`, `failed`, `cancelled`. At most one run per task in `queued`, `running` or `waiting` (unique partial index).
- Defaults: `max_parallel` 3, `max_running_minutes` 240, `max_cost_usd` 10, `time_zone` `UTC`. Heartbeat every 30 s; stale after 2 minutes. Events are kept 30 days after a run ends. `events` returns at most 500.
- `tasks.assignee` is `me` or `agent`, not null, default `me`.
- Connection `type`: `github`, `aws`, `slack`, `linear`, `gdrive`, `mcp`, `env`.
- Every table keyed to an item has an FK `→ items(id) ON DELETE CASCADE`, added to the SQL by hand. Run-child tables cascade from `agent_runs(id)`.
- Modules never import `@dlh/db`. `modules/agent` reads Tasks and Queue only through `w.call`.
- A service token is a random 32-byte base64url string, stored only as its SHA-256 hash.
- Copy (verbatim): "This run has ended" · "Cost cap reached ($10.00)" (where $10.00 is the cap that applied) · "Changed since" · "Needs you: <task title>".

## Review Focus

1. **Undo of Give to agent after the run started.** `assignRequest` undo while the run is `running` must be `CONFLICT` "Changed since" and revert nothing: no request reopened, no task deleted. Test: Task 9 `assignRequest undo after the run was claimed conflicts and changes nothing`.
2. **A run token calling something it shouldn't.** Calling `agent.assign`, `agent.claim` or a person-only operation (`ai: false`) with a run token is `FORBIDDEN`. A revoked run token is `UNAUTHORIZED`. Test: Task 3 `a run token is refused by user and worker operations` and `a revoked run token is unauthorized`.
3. **Two workers claiming at once with one free slot.** Exactly one gets a run, and the running count never goes over `max_parallel`. Test: Task 10 `concurrent claims never exceed the parallel limit`.
4. **Approve pressed on an older request.** `decide` with a `seq` that isn't the run's current `pending.seq` is `CONFLICT`. The same answer twice is a no-op. Test: Task 11 `decide on a stale seq conflicts` and `decide twice with the same answer is a no-op`.
5. **Completing the task by hand while the agent runs.** The next `heartbeat` returns `stop: true`, the run is `cancelled` and its token revoked, and `finish` after that is `CONFLICT` and doesn't complete the task twice. Test: Task 11 `heartbeat stops a run whose task was completed`.

## File structure

```
spikes/agent-gateway/                         throwaway, not merged (Task 1)
packages/core/src/ai/kinds.ts                 + "touchItems" effect
packages/core/src/operations/describe.ts      + access
packages/core/src/module.ts                   + DetailPanel, ModuleManifest.detailPanels
packages/db/src/schema.ts                     + serviceTokens; drizzle/0005_service_tokens.sql
packages/server/src/auth/tokens.ts            NEW: newToken, hashToken (moved from apps/api)
packages/server/src/auth/serviceTokens.ts     NEW: mint/revoke/find service tokens
packages/server/src/trpc.ts                   + Principal, Context.principal
packages/server/src/operations/router.ts      access check per procedure
packages/server/src/operations/implement.ts   + UndoToken.calls
packages/server/src/operations/undo.ts        + revertUndoToken
packages/server/src/ai/followups.ts           uses revertUndoToken
packages/server/src/items/writer.ts           + touchItem
packages/server/src/ai/scoped.ts              + touchItem behind "touchItems"
apps/api/src/trpc.ts, src/changes.ts          resolve service tokens
apps/api/src/cli/serviceTokens.ts             NEW: worker token create/revoke
apps/desktop/src/shell/Shell.tsx              gathers detailPanels
packages/client/src/index.tsx                 + useDetailPanels
modules/tasks/                                + assignee column, setAssignee, panels in TaskDetail
modules/agent/                                NEW package @dlh/module-agent
  src/db/schema.ts, drizzle/0000_agent.sql
  src/schema.ts                               shared zod: runStatus, pending, decision, report, settings
  src/operations.ts                           agentOps descriptions
  src/server.ts
  src/server/{assign,runs,worker,connections,settings,reads}.ts
  src/manifest.tsx                            no routes yet (Part 3)
  test/…
```

---

### Task 1: Gateway check (throwaway)

**Files:**
- Create (not merged): `spikes/agent-gateway/Dockerfile`, `spikes/agent-gateway/run.mjs`, `spikes/agent-gateway/README.md`
- Modify (merged): `docs/specs/agent-hub.md` (new section "Gateway check results", above Resolved questions)

**Interfaces:**
- Produces: the findings that Part 2 is written from: SDK or CLI, how a session resumes, and the cost of a typical run.

- [ ] **Step 1: Look up the Gateway's current Claude Code settings** in Vercel's AI Gateway docs ("Claude Code"): the base URL and which variable carries the key (`ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`). Write them in the README.
- [ ] **Step 2: Write `Dockerfile`:** `node:22-slim`, git, `npm i @anthropic-ai/claude-agent-sdk`, a non-root user, `CLAUDE_CONFIG_DIR=/workspace/.claude`, entrypoint `node /app/run.mjs`.
- [ ] **Step 3: Write `run.mjs`.** It calls `query({ prompt: process.argv[2], options: { cwd: "/workspace", permissionMode: "bypassPermissions", resume: process.env.RESUME || undefined } })`, prints every message as one JSON line, and at the end prints `session_id`, `num_turns`, `total_cost_usd` and `usage`.
- [ ] **Step 4: First run.** `docker volume create dlh-spike-ws`, then run the image with `-v dlh-spike-ws:/workspace`, the Gateway variables from Step 1, and the prompt `Clone https://github.com/<a small public repo>, add a one-line note to its README, and tell me the file you changed.` Expected: the run completes, the request shows in the Gateway's logs, and a `session_id` is printed.
- [ ] **Step 5: Resume in a fresh container.** Remove the first container, then run again on the same volume with `RESUME=<session_id>` and the prompt `What file did you change, and what line did you add?` Expected: it answers from the session without re-reading the repo. If it can't resume, try copying `~/.claude/projects` explicitly, and write down what worked.
- [ ] **Step 6: If Step 4 failed through the Gateway,** repeat Steps 4–5 with `claude -p --output-format stream-json --resume <id>` from `@anthropic-ai/claude-code` in the same image, and note that the harness switches to the CLI.
- [ ] **Step 7: Record the results in the spec.** Add "Gateway check results" with the date, harness (SDK or CLI), the base URL variable names (not the key), how resume works, the turns and cost of the Step 4 run, and whether the $10 default stands. Remove `spikes/` from the working tree.
- [ ] **Step 8: Commit** only the spec: `docs(agent-hub): Gateway check results`

---

### Task 2: Planning decisions in the spec

**Files:**
- Modify: `docs/specs/agent-hub.md`

- [ ] **Step 1: Write each "Decisions made while planning" item back into the spec.**
  - Core changes: `access` and `Principal`.
  - Operations: the flat names and `decide({ runId, seq, approve })`.
  - Data model: `pending` and `decision` in place of `waiting_on`, plus `time_zone` in settings.
  - Run lifecycle: heartbeat `stop`, the sweeps in `claim`, the advisory lock, Retry resolving the failure request.
- [ ] **Step 2: Commit** `docs(agent-hub): decisions from planning`

---

### Task 3: Service tokens and access

**Files:**
- Create: `packages/server/src/auth/tokens.ts`, `packages/server/src/auth/serviceTokens.ts`, `packages/db/drizzle/0005_service_tokens.sql` (generated), `apps/api/src/cli/serviceTokens.ts`
- Modify: `packages/db/src/schema.ts`, `packages/core/src/operations/describe.ts`, `packages/server/src/trpc.ts`, `packages/server/src/operations/router.ts`, `packages/server/src/index.ts`, `packages/server/src/testing.ts`, `apps/api/src/auth/tokens.ts` (re-export the moved functions), `apps/api/src/trpc.ts`, `apps/api/src/changes.ts`, `apps/api/package.json` (`"tokens": "tsx --env-file-if-exists=.env src/cli/serviceTokens.ts"`)
- Test: `packages/core/test/operations.test.ts` (extend), `packages/server/test/service-tokens.db.test.ts` (new), `apps/api/test/changes.test.ts` (extend; it is whichever test covers `changesHandler` today)

**Interfaces:**
- Produces:
  - Table `service_tokens`: `id` uuid default `uuidv7()`, `kind` text check `('worker','run')`, `token_hash` text unique not null, `run_id` uuid null, `created_at`, `revoked_at`, and check `service_tokens_run_check`: `(kind = 'run') = (run_id is not null)`. There is no FK on `run_id`, because Core doesn't know modules' tables.
  - `newToken(): string`, `hashToken(token: string): string` in `@dlh/server`.
  - `mintWorkerToken(db: Db): Promise<string>`, `mintRunToken(tx: Tx, runId: string): Promise<string>`, `revokeRunTokens(tx: Tx, runId: string): Promise<void>`, `findServiceToken(db: Db, token: string): Promise<Principal | null>` (null when the token is unknown or revoked).
  - `type Principal = { kind: "user"; session: Session } | { kind: "worker"; tokenId: string } | { kind: "run"; tokenId: string; runId: string }`. `Context` gains `principal: Principal | null`.
  - `OperationDescription.access?: "everyone" | "user" | "worker"`, and `accessOf(desc): "everyone" | "user" | "worker"` applies the default.
  - `testServer(db, modules, { principal? })` gives a caller as that principal. It defaults to you.
  - CLI: `pnpm --filter @dlh/api tokens worker create` prints a new worker token once. `tokens worker revoke <id>` revokes it.

- [ ] **Step 1: Write failing tests:**
  - core: `worker access needs palette false and ai false`, and `access defaults to everyone with ai and user without`.
  - `service-tokens.db.test.ts`, with an inline module that has one operation of each access:
    - `a worker token calls only worker operations`.
    - `a run token calls everyone operations`.
    - `a run token is refused by user and worker operations` (`FORBIDDEN`).
    - `a revoked run token is unauthorized`.
    - `you are refused by worker operations`.
    - `only the hash is stored`.
  - changes: `/changes accepts a worker token`, and `/changes refuses a run token`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/core test && pnpm --filter @dlh/server test:db -- service-tokens && pnpm --filter @dlh/api test`. Expected: FAIL.
- [ ] **Step 3: Implement the interfaces above.**
  - Run `pnpm --filter @dlh/db generate` after the schema change.
  - `createContext` tries a session first, then `findServiceToken`.
  - `procedureFor` in `operations/router.ts` uses a middleware per `accessOf(op.desc)`. With no principal it is `UNAUTHORIZED`; with a principal the access doesn't allow it is `FORBIDDEN`.
  - `ops.undo` and every Core router stay on `protectedProcedure` (you only).
- [ ] **Step 4: Run** the same commands, plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): worker and run service tokens; operations declare who may call them`

---

### Task 4: Undo of called operations

**Files:**
- Modify: `packages/server/src/operations/implement.ts`, `packages/server/src/operations/undo.ts`, `packages/server/src/ai/followups.ts`
- Test: `packages/server/test/operation-calls.db.test.ts` (extend), `modules/requests/test/writes.db.test.ts` (run as is)

**Interfaces:**
- Produces:
  - `UndoToken = { record: unknown; created: string[]; calls: { operation: string; record: unknown }[] }`. `runMutationIn` appends `{ operation: callee.desc.id, record: undo }` for each called mutation, in call order. Callers whose records are null are skipped.
  - `undoToken` zod: `calls` defaults to `[]`, so tokens stored earlier in `ai_requests.undo` still parse.
  - `revertUndoToken(w: ItemWriter, deps: CoreDeps, op: ImplementedMutation, token: z.infer<typeof undoToken>): Promise<void>` runs `revertMutation` for the caller, then for each `calls` entry in reverse (resolving the operation from `deps.operations`, or `BAD_REQUEST` "unknown operation" if it isn't there), then `deleteCreated`.
  - `ops.undo` and the AI follow-up undo (`followups.ts`, where it calls `deleteCreated` and `revert`) both call `revertUndoToken`.

- [ ] **Step 1: Write failing tests** in `operation-calls.db.test.ts`. Add a `alpha.rename` mutation that renames its subject and records the old title, and a `beta.renameBoth` mutation that renames its own subject and calls `alpha.rename` on another item.
  - `the callee's undo record is in the caller's token`.
  - `ops.undo reverts the callee's update as well as the caller's`.
  - `callee undos run after the caller's, last call first` (two calls that rename the same item A→B→C; undo ends at A).
  - `undo conflicts as a whole when the callee's item changed since` (the caller's item is unchanged after the failed undo).
  - `a token without calls still undoes`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db -- operation-calls`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Remove the doc comment on `runMutationIn` that says a callee's undo record is dropped.
- [ ] **Step 4: Run** `pnpm --filter @dlh/server test:db && pnpm --filter @dlh/module-requests test:db`. Expected: PASS, including Make task's existing undo tests.
- [ ] **Step 5: Commit** `feat(core): Undo reverts what called operations changed`

---

### Task 5: `touchItem` and detail panels

**Files:**
- Modify: `packages/core/src/ai/kinds.ts`, `packages/core/src/module.ts`, `packages/server/src/items/writer.ts`, `packages/server/src/ai/scoped.ts`, `apps/desktop/src/shell/Shell.tsx` (and the registry that gathers `homeWidgets`), `packages/client/src/index.tsx`, `modules/tasks/src/screens/TaskDetail.tsx`
- Test: `packages/server/test/writer.db.test.ts`, `packages/server/test/ai-scoped.db.test.ts`, `packages/client/test/client.test.tsx`, `apps/desktop/test/` (the test that covers task detail)

**Interfaces:**
- Produces:
  - `aiEffect` gains `"touchItems"`. It is not in `DIRECT_EFFECTS`.
  - `ItemWriter.touchItem(id: string): Promise<Item>` bumps `updated_at` the same way `mutate` does (`greatest(now, updated_at + 1 ms)`) on a live item with no version check, and adds it to the changed set. It is `NOT_FOUND` for a missing or deleted item.
  - `ScopedWriter.touchItem` is present when the effects include `"touchItems"`. It may touch any item.
  - `type DetailPanel = { itemType: string; id: string; label: string; component: ComponentType<{ itemId: string }>; order?: number }`, and `ModuleManifest.detailPanels?: DetailPanel[]`.
  - `ShellApi.detailPanels: DetailPanel[]`, and `useDetailPanels(itemType: string): DetailPanel[]` (that type's panels, sorted by `order`, panels with none last in registry order).
  - `TaskDetail` renders each panel from `useDetailPanels("task")` after its sections, as `<Panel itemId={id} />`.

- [ ] **Step 1: Write failing tests.**
  - writer: `touchItem bumps the version and publishes without expectedUpdatedAt`, and `touchItem on a deleted item is NOT_FOUND`.
  - scoped: `touchItem is absent without touchItems`.
  - client: `useDetailPanels returns one type's panels in order`.
  - desktop: `task detail renders a registered detail panel`. Use a fixture manifest with a `task` panel that renders its `itemId`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db -- writer ai-scoped && pnpm --filter @dlh/client test && pnpm --filter @dlh/desktop test`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Gather `detailPanels` where `homeWidgets` are gathered.
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): touchItem, and detail panels other modules add to an item page`

---

### Task 6: `tasks.assignee` and `tasks.setAssignee`

**Files:**
- Create: `modules/tasks/drizzle/0001_assignee.sql` (generated)
- Modify: `modules/tasks/src/db/schema.ts`, `modules/tasks/src/schema.ts` (`taskRow.assignee`), `modules/tasks/src/operations.ts`, `modules/tasks/src/server/writes.ts`, `modules/tasks/src/server/reads.ts`, `modules/tasks/src/server.ts`
- Test: `modules/tasks/test/writes.db.test.ts`, `modules/tasks/test/migration.db.test.ts`

**Interfaces:**
- Produces:
  - Column `assignee` text not null default `'me'`, with check `tasks_assignee_check` `in ('me','agent')`. `taskRow.assignee: "me" | "agent"`, exported as `assignee` zod from `modules/tasks/src/schema.ts`.
  - `taskOps.setAssignee`: id `tasks.setAssignee`, mutation, input `{ id, expectedUpdatedAt, assignee }`, effects `["updateItem"]`, `palette: false`, `ai: false`.
  - Its run writes through `writeTask` (so the item's version moves). It returns the item, with undo record `{ id, updatedAt, before: "me" | "agent" }`, or null when the assignee was already the asked one. Undo writes `before` back under the version check.

- [ ] **Step 1: Write failing tests:**
  - `a new task is assigned to me`.
  - `setAssignee changes the assignee and bumps the version`.
  - `setAssignee to the same value writes nothing`.
  - `setAssignee undo restores the assignee`.
  - `the assignee check refuses other values` (migration test, raw SQL).
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-tasks test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm --filter @dlh/module-tasks generate`. `tasks.get` and `tasks.list` return `assignee`.
- [ ] **Step 4: Run** `pnpm --filter @dlh/module-tasks test:db && pnpm --filter @dlh/module-tasks test`. Expected: PASS. The AI phrasing gate is unchanged, because `setAssignee` isn't an AI action.
- [ ] **Step 5: Commit** `feat(tasks): assignee, set only through tasks.setAssignee`

---

### Task 7: `modules/agent` package and tables

**Files:**
- Create: `modules/agent/{package.json,tsconfig.json,vitest.config.ts,drizzle.config.ts}` (as Tasks', name `@dlh/module-agent`, with dependencies `@dlh/module-tasks` and `@dlh/module-requests`), `modules/agent/src/db/schema.ts`, `modules/agent/drizzle/0000_agent.sql`, `modules/agent/src/schema.ts`, `modules/agent/src/module.ts` (`itemTypes: []`, no operations yet), `modules/agent/src/server.ts` (`migrations: true`, empty operations), `modules/agent/src/manifest.tsx` (no nav, `routes: () => []`)
- Modify: `modules/requests/package.json` (`"./operations": "./src/operations.ts"`, if it's missing), `apps/api` and `apps/desktop` package.json (workspace dependency, as for Requests). Run `pnpm gen:modules`. If `moduleParity` or `module-ids` assume every module has an item type, extend them to allow none.
- Test: `modules/agent/test/migration.db.test.ts`, `modules/agent/test/schema.test.ts`

**Interfaces:**
- Produces tables. Every FK cascades, `task_id` points at `items(id)` and is added by hand.
  - `agent_assignments(task_id pk, connection_ids uuid[] not null default '{}')`.
  - `agent_runs`:
    - Columns from the spec, with `pending` jsonb and `decision` jsonb in place of `waiting_on`. `report` is jsonb. `cost_usd` is numeric(10,4) default 0. `turns`, `input_tokens` and `output_tokens` are integers default 0.
    - Check `agent_runs_status_check`.
    - Unique partial index `agent_runs_active_task_idx` on `(task_id)` where status in (`queued`, `running`, `waiting`).
    - Index `agent_runs_queued_idx` on `(created_at)` where `status = 'queued'`.
  - `agent_run_events(run_id → agent_runs, seq int, at, kind check, data jsonb, pk (run_id, seq))`.
  - `agent_run_messages(id uuidv7, run_id → agent_runs, at, body text not null, delivered_at)`.
  - `agent_connections(id uuidv7, name unique, type check, scope_summary, created_at, disabled_at)`.
  - `agent_settings`: a single row (check `id = 1`) with `default_connection_ids`, `max_parallel` 3, `max_running_minutes` 240, `max_cost_usd` numeric 10, `instructions` text default '', `time_zone` text default 'UTC'.
- Zod in `src/schema.ts`: `runStatus`, `eventKind` (`text`, `tool`, `tool_result`, `file`, `permission`, `status`), `connectionType`, `pending`, `decision`, `report` (`{ summary, links: { label, url }[], filesChanged: string[] }`), `settings`, `runRow`.

- [ ] **Step 1: Write failing tests:**
  - migration: `a second active run for one task is refused`, `deleting the task item removes its runs, events and messages`, `settings has one row with the defaults`.
  - schema: `pending needs requestId, seq and kind`, and `report parses the spec's shape`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test:db && pnpm --filter @dlh/module-agent test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write the schema, run `pnpm --filter @dlh/module-agent generate`, add the `items` FK to the SQL, and seed the settings row in the migration (`INSERT … (id) VALUES (1)`).
- [ ] **Step 4: Run** the module's tests plus `pnpm --filter @dlh/api test:db -- module-tables` and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): module package and tables`

---

### Task 8: Agent operation descriptions

**Files:**
- Create: `modules/agent/src/operations.ts`
- Modify: `modules/agent/src/module.ts`
- Test: `modules/agent/test/operations.test.ts`

**Interfaces:**
- Produces `agentOps`, keyed as mounted. Inputs are from the spec unless noted. `runId`, `taskId` and `requestId` are uuids.
  - Person operations:
    - `assign`: effects `[]` (it writes only its own tables; `setAssignee` refreshes the task), calls `[taskOps.setAssignee]`, ai ✓, access `user`, ⌘K "Make AI task".
    - `assignRequest`: calls `[taskOps.create, taskOps.setAssignee, requestOps.resolve]`, ai ✓, access `user`, ⌘K "Give to agent".
    - `unassign`: calls `[taskOps.setAssignee]`, ⌘K "Back to me", ai ✓, access `user`.
    - `message`: ai ✗.
    - `cancel` and `retry`: ai ✓, access `user`. `retry` calls `[requestOps.resolve]`.
    - `decide({ runId, seq, approve })`: calls `[requestOps.resolve]`, palette ✗, ai ✗.
  - Person queries:
    - `run` and `events`: ai ✗.
    - `runs`: ai ✓, access `user`.
    - `connections` and `settings`: ai ✗.
  - Person mutations `setDefaultConnections({ ids })`, `disableConnection({ id })` and `setSettings(partial settings)`: ai ✗, palette ✗.
  - `unassign`, `cancel`, `retry` and `decide` have effects `["touchItems"]`, as do all the worker operations that change a run's state.
  - Worker operations, all `access: "worker"`, `palette: false`, `ai: false`:
    - `claim({})`, with calls `[taskOps.get, requestOps.get]` and effects `["touchItems"]`.
    - `heartbeat({ runId, turns, inputTokens, outputTokens, costUsd })`.
    - `appendEvents({ runId, events: { seq, at, kind, data }[] })`, at most 200 per call.
    - `takeMessages({ runId })`.
    - `suspend({ runId, sessionId, seq, kind: "approval" | "grant", title, body, tool?, inputHash?, connectionId? })`, with calls `[requestOps.file]`.
    - `finish({ runId, report })`, with calls `[taskOps.complete]`.
    - `fail({ runId, code, message })`, with calls `[requestOps.file]`.
    - `registerConnection({ name, type, scopeSummary })`.

- [ ] **Step 1: Write failing tests:**
  - `every worker operation is worker-only and hidden from ⌘K and AI`.
  - `no agent operation is callable by a run`: every operation's `accessOf` is `user` or `worker`.
  - `decide and retry declare requests.resolve` (needed for request actions).
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test`. Expected: FAIL.
- [ ] **Step 3: Write the descriptions.** For the ai ✓ operations, add their phrasings (at least 8 each, as Tasks does) to `modules/agent/test/ai-phrasings.ts`. Add them to the combined interpreter gate.
- [ ] **Step 4: Run** `pnpm --filter @dlh/module-agent test && pnpm test`. Expected: PASS, with the gate still at 90% or better.
- [ ] **Step 5: Commit** `feat(agent): operation descriptions`

---

### Task 9: Assigning and the person's run controls

**Files:**
- Create: `modules/agent/src/server/assign.ts`, `modules/agent/src/server/runs.ts`, `modules/agent/src/server/reads.ts`, `modules/agent/src/server/connections.ts`, `modules/agent/src/server/settings.ts`
- Modify: `modules/agent/src/server.ts`
- Test: `modules/agent/test/assign.db.test.ts`, `modules/agent/test/runs.db.test.ts`

**Interfaces:**
- Consumes: `w.call`, `w.touchItem`, `taskOps.*`, `requestOps.*`, `revokeRunTokens`.
- Produces:
  - `assign` upserts `agent_assignments` (connections default to `settings.default_connection_ids`), calls `setAssignee(agent)` and inserts a `queued` run. Its undo record is `{ runId, assignment: previous connection_ids | null }`. Undo deletes the run if it is still `queued`; otherwise it is `CONFLICT` "Changed since". Then it restores the assignment. The callee's undo restores the assignee.
  - `assignRequest`: `requests.get` → `tasks.create` → `setAssignee` → `requests.resolve(outcome task, taskId)` → assignment → queued run. Undo works as for `assign`, and Core reverts the callees and deletes the task.
  - `unassign` calls `setAssignee(me)` and cancels the active run (`status cancelled`, `finished_at`, tokens revoked). Its undo record is the callee's only, so the run stays cancelled.
  - `cancel` and `retry`:
    - Both return a null undo.
    - `retry` refuses runs that aren't `failed` or `cancelled` with `CONFLICT`.
    - `retry` resolves `pending.requestId` as `handled` when `pending.kind` is `failure`, clears `pending`, and sets the run to `queued`.
    - Each touches the task.
  - `message` refuses runs that aren't `running` or `waiting` with `BAD_REQUEST` "This run has ended".
  - The reads `run`, `runs`, `events` (after `seq`, at most 500), `connections` (not disabled first, then disabled) and `settings` return parsed rows.
  - `setDefaultConnections`, `disableConnection` and `setSettings` (partial, validated by `settings`).

- [ ] **Step 1: Write failing tests** on `freshModuleDb([tasksServer, requestsServer, agentServer])`:
  - `assign queues a run and sets the assignee`.
  - `assign uses the default connections when none are given`.
  - `assign undo removes the queued run and sets the assignee back`.
  - `assignRequest makes the task, resolves the request and queues a run in one transaction`.
  - `assignRequest undo deletes the task, reopens the request and removes the run`.
  - `assignRequest undo after the run was claimed conflicts and changes nothing` (claim by setting status directly).
  - `assigning a task with an active run is CONFLICT`.
  - `unassign cancels the active run`.
  - `retry of a failed run requeues it and resolves its failure request`.
  - `retry of a running run is CONFLICT`.
  - `message to a done run is "This run has ended"`.
  - `events returns at most 500 after seq`.
  - `setSettings refuses max_parallel 0`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test:db`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): assign, give to agent, and run controls`

---

### Task 10: `claim`

**Files:**
- Create: `modules/agent/src/server/worker.ts` (claim first; Task 11 adds the rest), `modules/agent/src/server/claimRules.ts`
- Modify: `modules/agent/src/server.ts`
- Test: `modules/agent/test/claimRules.test.ts`, `modules/agent/test/claim.db.test.ts`

**Interfaces:**
- Produces:
  - `canMove(from: RunStatus, to: RunStatus): boolean` in `claimRules.ts`, following the spec's lifecycle diagram (plus `failed` and `cancelled` → `queued` on Retry). Every write that changes a status checks it and is `CONFLICT` when it is false.
  - `isDueBy(due: Due | null, now: Date, timeZone: string): boolean` in `claimRules.ts`. A null due is always due. A timed due is due when `due.at <= now`. An all-day due is due when `dayOfDue(due, timeZone) <= todayIn(timeZone, now)`.
  - `claim` returns `{ run: null }`, or `{ run, token, task: { id, title, notes }, request: { sender, body } | null, connectionIds, sessionId, decision, messages }`.
  - In one transaction, `claim`:
    1. Takes the advisory lock.
    2. Sweeps stale heartbeats (`running` with `heartbeat_at < now − 2 min` → `queued`, tokens revoked, task touched).
    3. Deletes events of runs that ended more than 30 days ago.
    4. Stops if running ≥ `max_parallel`.
    5. Walks queued runs oldest first. For each it calls `tasks.get`. A missing task, a completed one, or one not assigned to `agent` gets its run cancelled. A task that isn't due yet is skipped. The first runnable one moves to `running` with `started_at` (if not set) and `heartbeat_at = now`, gets a token from `mintRunToken`, and its task is touched.
    6. Clears `decision`, marks undelivered messages delivered, and returns them.
  - The request comes from `requests.get` on the request linked to the task as its outcome. When there's none, it is `null`.

- [ ] **Step 1: Write failing tests:**
  - rules: `every illegal transition is refused` (a table of all 36 pairs), `no due is due`, `a timed due in the future waits`, `an all-day due is due from midnight in the settings time zone`.
  - db:
    - `claim takes the oldest queued run`.
    - `claim respects the parallel limit`.
    - `claim skips a task due later and takes the next`.
    - `claim cancels a run whose task was completed`.
    - `a missed heartbeat returns the run to queued and revokes its token`.
    - `concurrent claims never exceed the parallel limit` (two `Promise.all` claims with one free slot: exactly one run).
    - `two workers claiming at once get different runs` (two free slots).
    - `claim returns the request body for a task given from a request`.
    - `claim delivers a pending decision once`.
    - `events of runs ended over 30 days ago are removed`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test && pnpm --filter @dlh/module-agent test:db -- claim`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): claim, with the parallel limit, due times and stale-run sweeps`

---

### Task 11: The rest of the worker operations and `decide`

**Files:**
- Modify: `modules/agent/src/server/worker.ts`, `modules/agent/src/server/runs.ts` (`decide`), `modules/agent/src/server.ts`
- Test: `modules/agent/test/worker.db.test.ts`

**Interfaces:**
- Produces. Each operation below is refused with `CONFLICT` unless the run is `running` (except `decide`), and each state change touches the task and revokes the run token when the run leaves `running`.
  - `heartbeat` stores the counters and `heartbeat_at`, and returns `{ stop }`.
    - `stop` is true, and the run becomes `cancelled`, when the run is no longer `running` or its task is completed, missing or not assigned to the agent.
    - When `costUsd >= max_cost_usd` or the running time is ≥ `max_running_minutes`, it fails the run, as `fail` does, with "Cost cap reached ($X.XX)" or "Time cap reached (N min)", and returns `stop: true`.
  - `appendEvents` inserts the events and ignores a `seq` it already has (`on conflict do nothing`).
  - `takeMessages` returns the undelivered messages oldest first and marks them delivered.
  - `suspend`:
    - Files a request through `requests.file`:
      - `source: "agent"`, `externalId: "<runId>:<seq>"`, the title and body from the input.
      - `actions: [{ label: "Approve", operation: "agent.decide", input: { runId, seq, approve: true } }, { label: "Decline", …approve: false }]`.
    - Stores `pending` (with the filed request's id) and `session_id`, and sets the status to `waiting`.
  - `finish` writes `report` and `finished_at`, sets `done`, and calls `tasks.complete` on the task, all in one transaction.
  - `fail`:
    - Files "Needs you: <task title>" with `body` = the message and `actions: [{ label: "Retry", operation: "agent.retry", input: { runId } }]`.
    - Stores `pending` (`kind: "failure"`) and `failure_code` and `failure_message`, and sets `failed`.
  - `decide`:
    - `CONFLICT` unless the run is `waiting` and `seq === pending.seq`.
    - Records `decision`. On an approved grant it adds `pending.connectionId` to `connection_ids`.
    - Resolves the request as `handled`, clears `pending`, and sets `queued`.
    - Repeating the decided answer is a no-op; a different answer is `CONFLICT`. The previous decision is found through the resolved request's `externalId`.
  - `registerConnection` inserts or updates by `name` and returns `{ id }`.

- [ ] **Step 1: Write failing tests:**
  - `heartbeat stops a run whose task was completed`.
  - `heartbeat past the cost cap fails the run with "Cost cap reached ($10.00)"`.
  - `appendEvents ignores a repeated seq`.
  - `suspend files one request even when retried`.
  - `decide approves, resolves the request and queues the run`.
  - `decide on a stale seq conflicts`.
  - `decide twice with the same answer is a no-op`.
  - `an approved grant adds the connection`.
  - `finish completes the task and writes the report`.
  - `finish after a cancel is CONFLICT and the task stays open`.
  - `fail files "Needs you" with a Retry action`.
  - `the run token is revoked when the run leaves running`.
  - `the request's Approve action runs agent.decide through the Queue` (call `requests.file`'s stored action input with the person's caller).
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test:db -- worker`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): worker operations and decide`

---

## PRs

At most 2 PRs in CI at once.

| PR | Tasks | Branch |
| --- | --- | --- |
| Spec results | 1, 2 | `agent-hub-spec` (this branch) |
| Core | 3, 4, 5 | `agent-core` |
| Agent module | 6–11 | `agent-module`, stacked on `agent-core`; retarget it to `main` before deleting `agent-core` |
