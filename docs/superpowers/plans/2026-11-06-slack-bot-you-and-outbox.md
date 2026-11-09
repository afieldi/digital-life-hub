# Slack Bot, Part 2: You, the Outbox and the Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build steps 4–5 of the Slack Bot build order. When this lands:
- You can DM the bot to ask, capture and act on your hub, with Undo in Slack, and hand work to the agent.
- The bot never writes or sends a message as you. Drafts and the user token are removed (decided after Task 3; see Task 7).
- Agent reports come back to your DM.
- Escalation replies and agent posts actually reach Slack.
- A coworker's request handed to the agent runs with coworker audience: it can read only what involves them unless you approve a call, and it can reply in their DM on its own.

**Architecture:**
- `slack.handleMessage` gains an owner path. The owner interpreter (Jev, as in Part 1) picks an AI action and a kind, and a subject from search.
- The owner path never writes through its own writer. It runs each step in its own transaction through `deps`: the gateway's `prepare` / `apply` / `undo`, and `runMutation` for `agent.assignRequest`. So nothing it starts can see an uncommitted row or deadlock with it.
- Undo for operations the bot runs outside the gateway lives in a new `slack_actions` table.
- `apps/slack` renders buttons, accepts clicks only from you, and runs an outbox loop: `/changes` plus a 30 s timer, sending as the bot.
- For the agent, a run carries an `audience`. A Core hook lets the agent module refuse a coworker-audience run's out-of-audience calls unless you approved that exact call. The runner's permission hook asks first.

**Tech Stack:** TypeScript, Zod 4, tRPC 11, Drizzle + Postgres, Vitest, `@slack/bolt` 5.1.0 (Block Kit buttons, `block_actions`).

**Spec:** `docs/specs/slack-bot.md`.
- Read it with the Part 1 plan `docs/superpowers/plans/2026-11-06-slack-bot-base.md` and `docs/specs/agent-hub.md`.
- The interface digest this plan was written from is the current code. Where a name below differs from the spec, the plan's "Decisions made while planning" explains why.

**Later plans:** Part 3 covers reviews and the PR lookups once GitHub v1 exists, end-to-end tests, and the manual Done check.

**Decisions made while planning**

Task 1 writes each of these back into the spec.

- **The owner path writes nothing through `w`.** `handleMessage` runs inside a mutation's transaction, and everything you ask for must commit on its own, so each step runs through `deps`:
  - the gateway's `prepare` / `apply` / `undo` (each opens its own transaction);
  - `runMutation(deps, op, input)` for `requests.file`, `agent.assignRequest` and `agent.cancel`.

  So `handOff`'s request is committed before `assignRequest` reads it. A test pins that the owner path leaves no write in the outer transaction.
- **Owner interpretation is two decisions, not one.**
  - The first is a `choice` question. Its choices are every gateway AI action crossed with each kind it allows, as `"<actionId>|<kind>"`, plus `slack.handOff|do` and `escalate`.
  - The second, only when the picked action applies to items, chooses among up to 5 items from `searchItems` on the message text, plus `none`.
  - Below `threshold` on either decision, a pick of `none` for an action that needs an item, or `escalate`: the message escalates.
- **`prepare` takes an origin.** `prepare(deps, input, opts?: { origin?: "app" | "slack" })` writes `ai_requests.origin`. `slack.handleAction` acts only on rows with `origin = 'slack'`.
- **`slack_actions` holds Undo for operations the bot runs outside the gateway.** It holds `agent.assignRequest`'s Undo token from a handoff. A button's value names an `ai_requests` id or a `slack_actions` id, never a raw token.
- **No drafts, no request panel.** The user dropped reply-as-you drafts after Task 3. There is no user token, no `slack.draftReply` / `sendDraft` / `discardDraft` / `editDraft`, no `slack.requestInfo` and no request detail panel. The outbox posts only as the bot.
- **The outbox loop owns staleness.** `slack.pendingSends` is a mutation. It:
  - records `slack_settings.seen_at`, which Settings → Slack shows as "Bot last seen";
  - marks `approved` rows older than 24 h as `failed` with "Too old to send", so escalation replies queued while no sender existed never go out days late;
  - returns up to 20 `approved` rows, oldest first.
- **Reports need two agent reads.**
  - `agent.recentRuns({ since })`: runs that ended (`done` or `failed`) after `since`, with their task, request id, report and failure message.
  - `agent.runSource({ runId })`: the run's request id.

  Both are queries with `palette: false` and `ai: false`, reached through operation calls.
- **Who filed a request is stored.** `requests.file` gains `fromOwner?: boolean` (column `from_owner`, default false). Slack sets it for your messages, and the agent uses it to tell your requests from a coworker's without reading Slack's tables. A run's audience is `{ asker: { slackUserId: sourceHandle, githubLogin: null } }` when `source = 'slack'` and not `fromOwner`.
- **A run identifies itself by `runId` in the input.** Operations never see their caller. So:
  - Core checks that a run token's call carries `input.runId` equal to its own run, whenever the operation's input has a `runId` key.
  - The worker fills `runId` into such calls itself.

  `slack.postToSource({ runId, text })` relies on this.
- **Run guards are a server-module hook.** `defineServerModule(desc, { runGuard })`, where `runGuard(deps, { runId, operation, input }): Promise<void>` throws `FORBIDDEN` to refuse. Core calls every module's guard for a run principal before the operation runs. The agent module's guard enforces audience and consumes one-time hub approvals.
- **Asker operations are reachable by runs.**
  - An `audience: "asker"` operation may now be `access: "slack"` or `"everyone"`.
  - `describeOperation` also refuses an `asker` input that accepts `undefined` or `null`. This is the Part 1 deferred minor.
  - `requests.fromSender` becomes `access: "everyone"`, `palette: false`, `ai: true`, so the runner exposes it as a hub tool. The agent's guard limits its `asker` to the run's audience.
- **The approval hash is shared.**
  - `canonical`, `inputHash(tool, input)` and `hubToolName(operationId)` (`mcp__dlh__hub__<module>_<key>`) move to `@dlh/core`, and `@dlh/agent-protocol` re-exports them.
  - Approving a hub call adds `{ tool, inputHash, usedAt: null }` to `agent_runs.hub_approvals`. The guard recomputes the hash from the call and consumes a match.
- **The sender's GitHub login is read on the server.** `handleMessage` reads it from `slack_people` and ignores `sender.githubLogin` from `apps/slack`, because a coworker can edit the profile field. This is a final-review recommendation for Part 3.

## Global Constraints

- **Owner copy** (verbatim):
  - "Not sure what you meant, so I put it in your queue."
  - "Done: \<summary\>"
  - "Given to the agent: \<task title\>"
  - "Undid \<action\>." (the gateway's Undo summary)
  - "Changed since" (the gateway's or the operation's conflict text)
- **Buttons** (verbatim): "Undo", "Cancel run", "None of these". Each Suggest option's label is the option's label.
- **Agent report copy** (verbatim):
  - "Done: \<task title\>" then the report summary, then one line per link (`<label>: <url>`)
  - "The agent couldn't finish \<task title\>: \<failure message\>"
- **Thresholds and limits:**
  - Escalate below `slack_settings.threshold` (0.6) on either owner decision.
  - Jev 3 s per decision; context is the last 10 messages.
  - Subject candidates: at most 5.
  - Outbox: at most 20 rows per poll; poll every 30 s and on `/changes`.
  - Approved rows older than 24 h fail with "Too old to send".
  - `postToSource`: at most 5 posts per run, at most 2,000 characters each.
- **Only the owner's clicks act.** `apps/slack` ignores any `block_actions` from another user.
- **Never post as you.** No user token exists; every outbox row is sent as the bot. A run never posts as you.
- **Undo** works only on `ai_requests` rows with `origin = 'slack'` and `slack_actions` rows the bot made. Each is single use.
- **Module boundaries:** modules never import `@dlh/db` and never read another module's tables. Cross-module reads and writes go through `w.call` or `runMutation(deps, deps.operations.get(id), input)`.
- **A coworker-audience run, alone, may:**
  - call `audience: "asker"` operations whose `asker.slackUserId` is its audience's;
  - call operations whose subject is its own task or request;
  - call `requests.file` and `slack.postToSource`.

  Anything else needs a one-time approval, and the API refuses it otherwise.

## Review Focus

1. **Someone other than you clicks a button** in a thread they can see. Nothing happens, and they get no error. Test: Task 11 `a click from someone else does nothing`.
2. **A button pressed twice** (Undo twice, a Suggest option twice). The second press replies with the gateway's "already used" text and changes nothing. Test: Task 5 `a second undo is a no-op reply`.
3. **`apps/slack` was down** while escalation replies were queued and runs ended. On start, each goes out once. Escalation replies older than 24 h never go out. Test: Task 9 `old approved rows fail as Too old to send` and Task 12 `a restart sends what was approved, once`.
4. **"Rename the contract task" with two matching tasks**, or a task that doesn't exist. Low subject confidence, or `none`, escalates. It never acts on the wrong item. Test: Task 3 `an unsure subject escalates` and `no matching item escalates`.
5. **A coworker-audience run calls an out-of-audience operation**, gets it approved, then calls it again. The first call after approval passes; the second is `FORBIDDEN`. Test: Task 15 `an approved hub call passes once`.

## File structure

```
packages/core/src/hash.ts                         NEW: canonical, inputHash, hubToolName (moved from agent-protocol)
packages/core/src/operations/describe.ts          asker: access slack|everyone; asker input must reject undefined/null
packages/server/src/ai/gateway.ts                 prepare(deps, input, { origin })
packages/server/src/modules.ts, compose.ts        runGuard hook collected; CoreDeps.runGuards
packages/server/src/operations/router.ts          run principals: runId check, then run guards
packages/agent-protocol/src/{index,approval}.ts   re-export hash helpers; RunStart.audience, request.id
modules/requests/                                 from_owner column, file input fromOwner, RequestRow.fromOwner;
                                                  fromSender access everyone + ai
modules/slack/
  src/db/schema.ts, drizzle/0001_*.sql            slack_actions table; slack_settings.seen_at
  drizzle/0002_*.sql                              slack_outbox loses `as`, `draft` origin, pending/discarded
  src/server/owner/interpret.ts                   interpretOwner
  src/server/owner/run.ts                         runOwnerAction (gateway), handOff, cancelRun
  src/server/owner/index.ts                       handleOwner (the owner path)
  src/server/actions.ts                           slack.handleAction
  src/server/outbox.ts                            pendingSends, markSent, markFailed
  src/server/reports.ts                           syncRuns
  src/server/postToSource.ts                      postToSource
  test/owner-phrasings.ts                         40 labelled owner messages
modules/agent/                                    audience, coworker_connection_ids, hub_approvals; recentRuns, runSource;
                                                  assignRequest audience; claim passes audience + request id; runGuard
packages/agent-runner/src/{permissions,prompt}.ts audience-aware hub classification; coworker prompt wording
apps/agent/src/run/supervisor.ts                  fills runId into hub calls that take one
apps/slack/src/{blocks,actions,outbox}.ts          NEW: Block Kit buttons, block_actions handler, outbox loop
apps/slack/src/{api,main,events}.ts                new hub methods; wiring; /changes
```

---

### Task 1: Planning decisions in the spec

**Files:**
- Modify: `docs/specs/slack-bot.md`, `docs/specs/agent-hub.md`, `docs/specs/requests.md`

- [ ] **Step 1: Write each "Decisions made while planning" item into the spec.** Place them in Core changes, Agent hub changes, Data model (`slack_actions`, `seen_at`, `from_owner`), Operations (Slack) and Screens.
  - The Operations (Slack) table's `runEscalated` / `dismissEscalation` row still shows Part 1's old inputs. Update it to the shipped `{ slackUserId, externalId, command }`.
  - Add `draftReply`'s and `postToSource`'s real inputs.
- [ ] **Step 2: Mirror the agent hub decisions in `agent-hub.md`:** run audience, the run guard, hub approvals, `recentRuns` / `runSource`, and `runId` in hub calls. Add `fromOwner` to `requests.md`.
- [ ] **Step 3: Check the Operations table against the plan:** `grep -n "requestId, actionId" docs/specs/slack-bot.md` prints nothing.
- [ ] **Step 4: Commit:** `docs(slack-bot): planning decisions, part 2`

---

### Task 2: `prepare` takes an origin

**Files:**
- Modify: `packages/server/src/ai/gateway.ts`
- Test: `packages/server/test/ai-gateway.db.test.ts`

**Interfaces:**
- Produces: `prepare(deps: CoreDeps, input: AiPrepareInput, opts?: { origin?: "app" | "slack" }): Promise<AiResult>`. The row's `origin` is `opts.origin ?? "app"`. The tRPC procedure is unchanged, so the app always writes `app`.

- [ ] **Step 1: Write the failing test** `prepare records the origin it is given` (one row each for `slack` and the default `app`).
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db ai-gateway`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(ai): prepare records where a request came from`

---

### Task 3: The owner interpreter

**Files:**
- Create: `modules/slack/src/server/owner/interpret.ts`, `modules/slack/test/owner-phrasings.ts`
- Modify: `apps/api/src/cli/ai-eval-interpreter.ts` (a `--suite=slack-owner` mode, like `slack-coworker`)
- Test: `modules/slack/test/owner-interpret.db.test.ts`, `modules/slack/test/owner-phrasings.test.ts`

**Interfaces:**
- Consumes: `decideOnServer`, `deps.ai.runners` (action descriptions and kinds), `searchItems` (export it from `@dlh/server` if it isn't), `Turn`.
- Produces:
  ```ts
  type OwnerPick =
    | { kind: "action"; actionId: string; aiKind: AiKind; subjectId: string | null; confidence: number;
        alternatives: { actionId: string; aiKind: AiKind }[] }
    | { kind: "handOff" | "draftReply"; subjectId: string | null; confidence: number }
    | { kind: "escalate"; confidence: number; alternatives: { actionId: string; aiKind: AiKind }[] };
  interpretOwner(deps: CoreDeps, input: { text: string; context: Turn[]; model: string; timeoutMs: number; threshold: number }): Promise<OwnerPick>
  ```
  - The first decision's choices are `"<actionId>|<kind>"` for each runner and each kind its action allows, plus `slack.handOff|do`, `slack.draftReply|do` and `escalate`. Each choice's description is the action's description plus the kind in words: Ask "answer only", Suggest "offer options", Do "do it".
  - The second decision runs only for an action that doesn't apply to `"none"`, or for `draftReply` (subject must be a `request`). Its choices are the top 5 `searchItems` hits for the text, then `none`.
  - Below `threshold` on either decision, or `none` where an item is needed: `{ kind: "escalate" }`.
  - Purposes are `slack.ownerAction` and `slack.ownerSubject`.

- [ ] **Step 1: Write the failing tests** with a fake `decide`:
  - `offers every action and kind, plus handOff, draftReply and escalate`
  - `an action on items asks a second question over the search hits`
  - `an unsure subject escalates`
  - `no matching item escalates`
  - `an action that applies to none asks one question`
  - `the owner phrasings run at 90% or better`: the live suite, skipped without `AI_GATEWAY_API_KEY`. Its 40 phrasings cover capture ("remind me to chase Dana Friday" → `tasks.create|do`), ask ("what's due today?"), retitle, a request lookup, handOff, draftReply, and 6 that should escalate.
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-slack test:db owner-interpret`. Expected: FAIL.
- [ ] **Step 3: Implement** `interpretOwner`.
- [ ] **Step 4: Run** the tests. Then run `pnpm ai:eval-interpreter --suite=slack-owner` once with the Gateway key. Expected: PASS and ≥ 90%. Below that, rewrite descriptions (not phrasings), at most 3 times, and report each score.
- [ ] **Step 5: Commit:** `feat(slack): the owner interpreter`

---

### Task 4: `slack_actions`, `seen_at` and the owner path

**Files:**
- Modify: `modules/slack/src/db/schema.ts` and a generated migration, `src/schema.ts`, `src/operations.ts`, `src/server/handleMessage.ts`
- Create: `modules/slack/src/server/owner/run.ts`, `modules/slack/src/server/owner/index.ts`
- Test: `modules/slack/test/owner.db.test.ts`

**Interfaces:**
- Consumes: `interpretOwner` (Task 3), `prepare` with origin (Task 2), `escalate` (Part 1, `coworker.ts`).
- Produces:
  - **Table `slack_actions`:** `id uuid pk uuidv7()`, `operation text not null`, `token jsonb not null`, `run_task_id uuid null`, `created_at`, `used_at timestamptz null`. Nothing keys it to an item.
  - **Column `slack_settings.seen_at`:** timestamptz, null.
  - **`handleMessageResult`** gains `buttons?: { label: string; value: string }[]`, where `value` is the JSON of a `handleActionInput` (Task 5).
  - **`HandleActionInput`:**
    ```ts
    { do: "apply"; aiRequestId: string; option: number }
    | { do: "discard"; aiRequestId: string }
    | { do: "undo"; aiRequestId: string }
    | { do: "undoAction"; slackActionId: string }
    | { do: "cancelRun"; taskId: string }
    ```
  - **`handleOwner(deps: CoreDeps, input: HandleMessageInput, settings: SlackSettings): Promise<HandleMessageResult>`** in `owner/index.ts`. `handleMessage`'s owner short-circuit calls it, and it writes nothing through `w`.
  - **`runOwnerAction(deps, { text, actionId, aiKind, subjectId }): Promise<HandleMessageResult>`** in `owner/run.ts`. It calls `prepare(deps, { text, actionId, kind: aiKind, itemId: subjectId ?? undefined }, { origin: "slack" })` and maps the result:
    - `answered` → `reply: answer`
    - `listed` → `reply: heading` plus one `• <title>` line per item
    - `suggested` → `reply: "Pick one:"`, one button per option (`apply`, option index), then "None of these" (`discard`)
    - `applied` → `reply: "Done: <summary>"` with an "Undo" button (`undo`)
    - an `AiError` → `reply`: its message
  - **Escalation.** `{ kind: "escalate" }` files the message as "Bot wasn't sure: \<first line\>" with **no actions** at all, so the request keeps its normal outcomes (Make task, Handled, Not for me). Do not reuse Part 1's `escalate`: it always adds "Neither", which would hide them. Filing runs through `runMutation(deps, requests.file, { …slack fields, fromOwner: true })` once Task 6 adds `fromOwner`; until then, without it. Then reply "Not sure what you meant, so I put it in your queue.".
  - **A `handOff` pick** routes to Task 6. Until it lands, the routing throws `NOT_IMPLEMENTED`, and Task 6 replaces the branch. (Task 3 also returns a `draftReply` pick until Task 7 removes it; route it to the same `NOT_IMPLEMENTED` branch.)

- [ ] **Step 1: Write the failing tests** (fake `decide` and `complete`):
  - `an owner Do runs through the gateway with origin slack and offers Undo`
  - `an owner Ask replies with the answer`
  - `an owner Suggest offers each option and None of these`
  - `an owner message that is unsure escalates to the queue`
  - `the owner path writes nothing through the message's writer`: assert `handleMessage`'s undo token has no `created` and no `calls`, while the task exists after it.
  - `a gateway failure replies with its message`
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-slack test:db owner`. Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the migration with `pnpm --filter @dlh/module-slack generate`.
- [ ] **Step 4: Run** the module's `test:db` and `pnpm typecheck`. Expected: PASS. The Part 1 test that expected "I can't do that from Slack yet." is updated.
- [ ] **Step 5: Commit:** `feat(slack): you can ask, capture and act from Slack`

---

### Task 5: `slack.handleAction`

**Files:**
- Create: `modules/slack/src/server/actions.ts`
- Modify: `modules/slack/src/operations.ts`, `src/schema.ts` (`handleActionInput`), `src/server.ts`
- Test: `modules/slack/test/actions.db.test.ts`

**Interfaces:**
- Consumes: the gateway's `apply`, `discard` and `undo` (`@dlh/server`), `revertUndoToken`, `slack_actions`.
- Produces: `slack.handleAction(handleActionInput)`, a mutation with `access: "slack"`, palette/ai false and `calls: []`. Result `{ reply: string; buttons?: Button[] }`.
  - `apply`, `discard` and `undo` refuse an `ai_requests` row whose origin isn't `slack` (`FORBIDDEN`).
  - `apply` → `"Done: <summary>"` with "Undo".
  - `discard` → "OK, dropped.".
  - `undo` → `"Undid <action>."` (the gateway's summary, with a trailing period).
  - `undoAction` reverts a `slack_actions` row once: it sets `used_at`, and a used row replies "Already undone.". A conflict replies "Changed since". When `run_task_id` is set, the conflict reply carries a "Cancel run" button.
  - `cancelRun` runs `agent.cancel({ id: taskId })` through `runMutation` and replies "Cancelled.".
  - Each step runs on `deps` in its own transaction, as in Task 4.
  - A gateway `RequestUsedError` replies with its message, not an error.

- [ ] **Step 1: Write the failing tests:**
  - `apply runs the chosen option and offers Undo`
  - `undo reverts a Do`
  - `a second undo is a no-op reply`
  - `a row the app made is refused`
  - `undoAction reverts once`
  - `cancelRun cancels the task's run`
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-slack test:db actions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): buttons apply, undo and cancel`

---

### Task 6: `requests.fromOwner` and handing off to the agent

**Files:**
- Modify: `modules/requests/src/{schema,db/schema,operations}.ts`, `src/server/{writes,reads}.ts`, a generated migration, `docs/specs/requests.md`
- Modify: `modules/slack/src/server/coworker.ts` (`file` passes `fromOwner: m.sender.isOwner`), `src/server/owner/run.ts`
- Test: `modules/requests/test/writes.db.test.ts`, `modules/slack/test/handoff.db.test.ts`

**Interfaces:**
- Produces:
  - Column `requests.from_owner boolean not null default false`. `fileInput.fromOwner?: boolean`. `RequestRow.fromOwner: boolean`.
  - `handOff(deps, m: CoworkerMessage, subjectId: string | null): Promise<HandleMessageResult>`. It:
    1. files the message through `runMutation(deps, requests.file, { …slack fields, fromOwner: true })`, title = first line;
    2. runs `runMutation(deps, agent.assignRequest, { id, expectedUpdatedAt })`;
    3. stores the Undo token in `slack_actions` with `operation: "agent.assignRequest"` and `run_task_id` = the new task;
    4. replies `"Given to the agent: <task title>"` with "Undo" (`undoAction`) and "Cancel run" (`cancelRun`).

    `subjectId` is unused for now. "Have the agent review #123" stays plain text until Part 3.

- [ ] **Step 1: Write the failing tests:**
  - `file stores fromOwner`
  - `handOff files, assigns and offers Undo and Cancel run`
  - `undo of a handoff before the claim deletes the run and the task`
  - `undo after the claim says Changed since and offers Cancel run`
- [ ] **Step 2: Run** the requests and slack `test:db`. Expected: FAIL.
- [ ] **Step 3: Implement**, replacing Task 4's `handOff` placeholder.
- [ ] **Step 4: Run** both modules' `test:db`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): hand work to the agent from your DM`

---

### Task 7: Remove drafts and the user token

The user dropped reply-as-you drafts after Task 3 had shipped its `draftReply` pick, and after Part 1 had shipped the user token and the outbox's `as` column. This task removes them.

**Files:**
- Modify: `modules/slack/src/server/owner/interpret.ts`, `src/server/owner/index.ts` (the `draftReply` branch), `test/owner-interpret.db.test.ts`, `test/owner-phrasings.ts`, `test/owner-phrasings.test.ts`
- Modify: `modules/slack/src/db/schema.ts` and a generated migration; every outbox insert (`git grep -n slackOutbox modules/slack/src`); `test/migration.db.test.ts`
- Modify: `apps/slack/src/config.ts`, `apps/slack/test/config.test.ts`, `deploy/vps/.env.example`, `deploy/vps/docker-compose.yml`, `deploy/vps/README.md`

**Interfaces:**
- Produces:
  - `OwnerPick`'s second variant is `{ kind: "handOff"; subjectId: null; confidence: number }`. The first decision's choices are the actions × kinds, `slack.handOff|do` and `escalate`. Nothing else in `interpretOwner` changes.
  - `slack_outbox` has no `as` column. `origin` is one of `agent`, `report`, `review_ping`, `escalation`. `status` is one of `approved`, `sent`, `failed`, default `approved`. The migration deletes any `draft` row first (there are none in practice).
  - `apps/slack`'s config has no `userToken`, and `SLACK_USER_TOKEN` is gone from compose, `.env.example` and the README.

- [ ] **Step 1: Update the tests first:**
  - `offers every action and kind, plus handOff and escalate` (renamed; `slack.draftReply|do` is not offered)
  - delete `draftReply asks for a request among the hits, and only requests are offered`
  - the owner phrasings lose their `draftReply` entries; keep the suite's size by adding the same number of capture or ask phrasings
  - `the outbox refuses a draft origin` replaces the `as me` migration tests
  - the config test no longer lists `SLACK_USER_TOKEN`
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-slack test:db` and `pnpm --filter @dlh/slack test`. Expected: FAIL.
- [ ] **Step 3: Implement**, and generate the migration with `pnpm --filter @dlh/module-slack generate`.
- [ ] **Step 4: Run** both commands, `pnpm typecheck` and `pnpm lint`. Expected: PASS. Then `pnpm ai:eval-interpreter --suite=slack-owner` once with the Gateway key: report the score; the gate is 85%.
- [ ] **Step 5: Commit:** `refactor(slack): no drafts, no user token`

---

### Task 8: (dropped)

The request detail panel existed for drafts. It is dropped with them; nothing to build.

---

### Task 9: Outbox operations

**Files:**
- Create: `modules/slack/src/server/outbox.ts`
- Modify: `modules/slack/src/operations.ts`, `src/server.ts`, `src/schema.ts`, `src/screens/SettingsSection.tsx` ("Bot last seen")
- Test: `modules/slack/test/outbox.db.test.ts`

**Interfaces:**
- Produces (all `access: "slack"`, palette/ai false):
  - **`slack.pendingSends()`** (mutation):
    - sets `seen_at = now`;
    - marks `approved` rows with `approved_at` older than 24 h `failed`, `error` "Too old to send";
    - returns up to 20 `approved` rows, oldest first, as `{ id, channelId, threadTs, text }`.
  - **`slack.markSent({ id, ts })`**: `approved` → `sent`, `sent_ts`, `sent_at`. Any other status is a no-op (idempotent).
  - **`slack.markFailed({ id, error })`**: `approved` → `failed` with `error`. Any other status is a no-op.
  - `slack.settings` returns `seenAt`, and Settings → Slack shows "Bot last seen \<time\>" or "Bot not seen yet".

- [ ] **Step 1: Write the failing tests:**
  - `pendingSends returns approved rows oldest first and records seen_at`
  - `old approved rows fail as Too old to send`
  - `markSent twice is a no-op`
  - `markFailed records the error`
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-slack test:db outbox`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): outbox operations`

---

### Task 10: Agent reads and reports

**Files:**
- Modify: `modules/agent/src/{operations,server}.ts`, `modules/agent/src/server/reads.ts`
- Create: `modules/slack/src/server/reports.ts`
- Modify: `modules/slack/src/operations.ts`, `src/server.ts`, `modules/slack/package.json` (depends on `@dlh/module-agent`)
- Test: `modules/agent/test/reads.db.test.ts`, `modules/slack/test/reports.db.test.ts`

**Interfaces:**
- Produces:
  - **`agent.recentRuns({ since: Date })`**: a query, palette/ai false (access `user`). It returns `{ runs: { id, taskId, taskTitle, requestId: string | null, status: "done" | "failed", finishedAt, report: Report | null, failureMessage: string | null }[] }`: runs with `finished_at > since`, oldest first, at most 100.
  - **`agent.runSource({ runId })`**: a query, palette/ai false. It returns `{ taskId, requestId: string | null }`, or `NOT_FOUND` "No run".
  - **`slack.syncRuns()`**: a mutation, `access: "slack"`, calling `agent.recentRuns` and `requests.get`.
    - With `runs_synced_at` null, it sets it to now and does nothing else.
    - Otherwise, for each run whose request is `source = "slack"` and `fromOwner`, it inserts an outbox row `{ origin: "report", as: "bot", status: "approved", key: "report:<runId>", channel/thread from the request }` with the report copy from Global Constraints.
    - It then advances `runs_synced_at` to the last `finishedAt` seen.

- [ ] **Step 1: Write the failing tests:**
  - `recentRuns lists ended runs after since, oldest first`
  - `syncRuns reports a run from your DM once`
  - `syncRuns skips a coworker's run and a run with no request`
  - `a failed run reports its failure`
  - `the first syncRuns only starts the clock`
- [ ] **Step 2: Run** the agent and slack `test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): agent reports come back to your DM`

---

### Task 11: Buttons in `apps/slack`

**Files:**
- Create: `apps/slack/src/blocks.ts`, `apps/slack/src/actions.ts`
- Modify: `apps/slack/src/{api,events,main}.ts`
- Test: `apps/slack/test/actions.test.ts`, `apps/slack/test/events.test.ts`

**Interfaces:**
- Consumes: `HandleMessageResult.buttons`, `slack.handleAction`.
- Produces:
  - `blocksFor(text, buttons?): { text: string; blocks?: unknown[] }`: a section with the text, plus an actions block with one button per entry. `action_id` is `dlh_<index>`, and `value` is the button value (at most 2000 characters, Slack's limit).
  - `handleBlockAction(deps, body): Promise<void>`:
    - ignores any click whose `body.user.id` isn't the owner;
    - otherwise parses `value`, calls `api.handleAction` with retries as for messages, and posts the reply with its buttons in the same thread;
    - on failure it posts "Can't reach the hub right now.".
  - `HubApi` gains `handleAction`. `main.ts` registers `app.action(/^dlh_/, …)` and acks at once.

- [ ] **Step 1: Write the failing tests:**
  - `a reply with buttons posts an actions block`
  - `a click from you calls handleAction and posts the reply in the thread`
  - `a click from someone else does nothing`
  - `an unreadable button value is ignored`
- [ ] **Step 2: Run** `pnpm --filter @dlh/slack test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): buttons, and only your clicks count`

---

### Task 12: The outbox loop

**Files:**
- Create: `apps/slack/src/outbox.ts`
- Modify: `apps/slack/src/{api,main}.ts`
- Test: `apps/slack/test/outbox.test.ts`

**Interfaces:**
- Consumes: `slack.syncRuns`, `slack.pendingSends`, `slack.markSent`, `slack.markFailed`, `/changes` (copy `onChanges` from `apps/agent/src/api.ts`).
- Produces:
  - `createOutbox(deps: { api; bot: SlackWeb; log? }): { tick(): Promise<void> }`. A tick:
    1. calls `syncRuns`;
    2. calls `pendingSends`;
    3. posts each row with `chat.postMessage({ channel: channelId, text, thread_ts: threadTs ?? undefined })` with the bot client;
    4. then calls `markSent` with the posted `ts`, or `markFailed` with Slack's error code.

    Ticks never overlap: a tick requested while one runs runs once after it.
  - `main.ts` ticks on start, on every `/changes` event and every 30 s.

- [ ] **Step 1: Write the failing tests** (stub API, stub clients, fake timers):
  - `a report is posted as the bot in its thread`
  - `a restart sends what was approved, once`
  - `a Slack error marks the row failed with its code`
  - `ticks never overlap`
- [ ] **Step 2: Run** `pnpm --filter @dlh/slack test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): the outbox loop`

---

### Task 13: The sender's GitHub login comes from the hub

**Files:**
- Modify: `modules/slack/src/server/handleMessage.ts` (read `slack_people` for `sender.slackUserId`; ignore `input.sender.githubLogin`)
- Test: `modules/slack/test/handleMessage.db.test.ts`

- [ ] **Step 1: Write the failing test** `a manual GitHub login wins over the one Slack sent`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the module's `test:db`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(slack): the sender's GitHub login comes from the hub`

---

### Task 14: Core: hashes, asker rules, run identity and run guards

**Files:**
- Create: `packages/core/src/hash.ts` (move `canonical` and `inputHash` from `packages/agent-protocol/src/approval.ts`; add `hubToolName`). `agent-protocol` re-exports them, with its callers unchanged.
- Modify: `packages/core/src/operations/describe.ts`, `packages/server/src/{modules,compose}.ts`, `packages/server/src/operations/router.ts`, `packages/server/src/trpc.ts` (`CoreDeps.runGuards`)
- Modify: `modules/requests/src/operations.ts` (`fromSender`: `access: "everyone"`, `palette: false`, `ai` default true)
- Test: `packages/core/test/hash.test.ts`, `packages/core/test/operations.test.ts`, `packages/server/test/run-guards.db.test.ts`

**Interfaces:**
- Produces:
  - `hubToolName(operationId: string): string` → `"mcp__dlh__hub__<module>_<key>"`, matching the runner's tool names.
  - `inputHash(tool, input)` is unchanged: same output for the same input as before the move.
  - `describeOperation`: `audience: "asker"` allows `access` `"slack"` or `"everyone"`. The `asker` schema must also reject `undefined` and `null`.
  - **Run identity:** for a run principal, if the operation's input shape has `runId` and `input.runId !== principal.runId` → `FORBIDDEN` "Not this run".
  - **Run guards:** `ServerModule.runGuard?: (deps: CoreDeps, call: { runId: string; operation: ImplementedOperation; input: unknown }) => Promise<void>`. They are collected into `CoreDeps.runGuards` and awaited in order for every run-principal call, after access and identity and before the operation. Operation calls (`w.call`) are not guarded: a callee runs as its caller already ran.

- [ ] **Step 1: Write the failing tests:**
  - `hubToolName matches the runner's tool names` (compare with `packages/agent-runner` `hubOperations()` names)
  - `inputHash is unchanged by the move` (a fixed vector)
  - `an asker input that accepts undefined is refused`
  - `asker operations may be everyone`
  - `a run token with another run's runId is forbidden`
  - `a run guard can refuse a run's call`
  - `guards don't run for you or for operation calls`
- [ ] **Step 2: Run** the core and server tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test`, and `pnpm test:db` for server, requests, slack and agent. Expected: PASS. `fromSender`'s `expectAskerScoped` test still passes.
- [ ] **Step 5: Commit:** `feat(core): run identity, run guards and shared approval hashes`

---

### Task 15: Agent: run audience, coworker connections and hub approvals

**Files:**
- Modify: `modules/agent/src/db/schema.ts` and a generated migration, `src/schema.ts`, `src/server/{assign,worker,runs,settings}.ts`, `src/server.ts` (`runGuard`)
- Test: `modules/agent/test/audience.db.test.ts`

**Interfaces:**
- Consumes: `requests.get` (`fromOwner`), `inputHash` and `hubToolName` (Task 14), the `runGuard` hook.
- Produces:
  - **Columns:**
    - `agent_runs.audience jsonb null` (`{ asker: { slackUserId, githubLogin: null } }`)
    - `agent_runs.hub_approvals jsonb not null default '[]'` (`{ tool, inputHash, usedAt: string | null }[]`)
    - `agent_settings.coworker_connection_ids uuid[] not null default '{}'`. The settings zod and `setSettings` gain `coworkerConnectionIds`.
  - **`assignRequest`:** audience as in the planning decisions. With an audience and no `connections` given, the run starts with `coworker_connection_ids`. `assign` (a task, no request) never has an audience.
  - **`claim`'s result:** `audience` on the run row, and `request.id`.
  - **`decide`**, approving a pending approval whose `tool` starts with `mcp__dlh__hub__`, appends `{ tool, inputHash, usedAt: null }` to `hub_approvals`.
  - **The agent `runGuard`:**
    1. Load the run. With no audience, allow.
    2. Allow an `audience: "asker"` operation whose `input.asker.slackUserId` equals the audience's.
    3. Allow an operation whose `subject(input)` is the run's task or request id.
    4. Allow `requests.file` and `slack.postToSource`.
    5. Otherwise, consume the first unused approval whose `tool === hubToolName(op.id)` and `inputHash === inputHash(tool, input)`: set its `usedAt` in the guard's own transaction (`writeItems` or `deps.db.transaction`), under `select … for update` on the run. The guard runs before the operation's transaction, so an approved call that then fails has still spent its approval. That's acceptable: you can approve again.
    6. Else throw `FORBIDDEN` "Needs your approval".
  - Settings → Agent gains "Connections for coworkers' requests", a multi-select like the default set.

- [ ] **Step 1: Write the failing tests:**
  - `a coworker's request gives the run an audience and the coworker connections`
  - `your own Slack request gives no audience`
  - `claim passes the audience and the request id`
  - `an asker lookup for the audience is allowed`
  - `an asker lookup for someone else is forbidden`
  - `an out-of-audience call is forbidden`
  - `an approved hub call passes once`
  - `a run with no audience is not guarded`
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test:db audience`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the agent module's `test:db` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(agent): coworker-audience runs`

---

### Task 16: `slack.postToSource`, and the worker and runner

**Files:**
- Create: `modules/slack/src/server/postToSource.ts`
- Modify:
  - `modules/slack/src/{operations,server}.ts`
  - `packages/agent-protocol/src/index.ts` (`runStart.audience`, `request.id`)
  - `apps/agent/src/run/supervisor.ts` (fill `runId`)
  - `packages/agent-runner/src/{permissions,prompt}.ts`
- Test: `modules/slack/test/postToSource.db.test.ts`, `apps/agent/test/supervisor.test.ts`, `packages/agent-runner/test/{permissions,prompt}.test.ts`

**Interfaces:**
- Produces:
  - **`slack.postToSource({ runId, text })`**: a mutation, `access: "everyone"`, `palette: false`, `ai` default true (so runs see it), calling `agent.runSource` and `requests.get`.
    - It refuses a request not from Slack (`BAD_REQUEST` "This run didn't come from Slack").
    - `text` is 1–2000 characters.
    - A 6th post for the run is `CONFLICT` "Five posts per run".
    - It inserts outbox `{ origin: "agent", as: "bot", status: "approved", key: "agent:<runId>:<n>", runId, channel/thread from the request }`.
  - **The worker's `hub()`:** for an operation whose input has `runId`, it sets `input.runId` to the claimed run's id before calling.
  - **The runner's `classify`:** with `start.audience` set, a `hub__*` tool is `alone` only under rules 2–4 of the guard (asker match, own task or request, the two allowed operations), else `ask`. The ask suspends with the usual approval, and the worker words it as for any tool. Without an audience it is unchanged (`alone`). `ClassifyContext` gains `audience`, `taskId` and `requestId`.
  - **`buildPrompt`** with an audience adds, after the rules:

    > This task came from \<sender\>, who reads what you post with postToSource. Use only what involves them; reading anything else of the owner's needs the owner's approval.

- [ ] **Step 1: Write the failing tests:**
  - `postToSource queues an approved bot post to the request's thread`
  - `a sixth post is refused`
  - `a request not from Slack is refused`
  - `the worker fills runId`
  - `with an audience, an out-of-audience hub tool asks`
  - `with an audience, the asker lookup for the audience is alone`
  - `the prompt names the coworker`
- [ ] **Step 2: Run** the slack `test:db`, and `pnpm --filter @dlh/agent test` and `pnpm --filter @dlh/agent-runner test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands, then `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(slack): the agent replies in the thread it came from`

---

### Task 17: The Part 2 check

**Files:**
- Modify: `deploy/vps/README.md` (Interactivity is now required; the Settings → Agent coworker connections step), `docs/specs/slack-bot.md` (Build order: mark steps 4–5 built)

- [ ] **Step 1: Run** the full suite: `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm lint`. Expected: all pass, with lint showing 0 errors.
- [ ] **Step 2: Update the README and spec as above.** In the README, add the Part 2 manual checks for the user:
  - "remind me to chase Dana Friday" → a task, and Undo removes it;
  - "what's due today?" answers;
  - "have the agent do X" starts a run with no further confirm, and its report lands in the DM;
  - a coworker's request given to the agent replies in their DM, and an out-of-audience read files an approval;
  - restarting `apps/slack` sends queued escalation replies and agent posts once.
- [ ] **Step 3: Commit:** `docs(slack-bot): part 2 checks`
