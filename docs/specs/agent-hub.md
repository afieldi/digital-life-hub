# Agent Hub — Deep-dive Spec

Nov 2, 2026 · Arek · Agreed Nov 4, 2026

## Scope

The heavy kind of AI. You mark a task as an AI task and the agent picks it up, works on it alone for minutes or hours in its own container, and completes it with a report. It asks you, through the [Queue](requests.md), only for the few actions that leave its container unchecked, and for connections it wasn't given. The light kind, the [AI gateway](ai-gateway.md), is unchanged. Part of the [Digital Life Hub overview](../overview.md).

**In scope**

- `tasks.assignee` and the `modules/agent` module: runs, run events, messages, connection metadata, settings, operations and screens
- `apps/agent`: a worker service next to `apps/api` that claims runs, starts containers, holds connection secrets and relays model calls
- `packages/agent-runner`: what runs inside a container. An Agent SDK session, the permission hook, the hub MCP server, grants, suspend and resume
- Connections (GitHub, AWS, Slack, Linear, Google Drive, any MCP server, plain environment variables), given to a run least-privilege and granted mid-run on request
- Core: service tokens, callee undo records in the undo token, a detail-panel slot in the manifest, and touching an item without a version check
- Hosting: one always-on VPS running Postgres, `apps/api` and `apps/agent` through docker-compose

**Out of scope**

- A runner on a second host
- Workspaces as saved presets of connections. They can be added later on top of connection lists
- Other harnesses (Codex)
- The Slack bot. It makes AI tasks through `agent.assign` later
- Scheduled or recurring AI tasks
- The light gateway's move from OpenRouter to Vercel AI Gateway (a separate small change)

**Done when**

1. A real AI task on a real repo goes from Give to agent on a request to a merged PR, with you approving the merge from the Queue.
2. A run that needs a connection it wasn't given asks for it, suspends, and resumes after you grant it.
3. A message sent to a running run changes what it does next.
4. Restarting the agent host mid-run resumes the run from its session.
5. The Gateway key and connection secrets never appear in a container's environment, image or log.

## Decisions

| Topic | Decision |
| --- | --- |
| Two kinds of AI | The gateway answers you in seconds; the Agent hub picks up work alone and runs long |
| Approval | Marking a task as an AI task is the approval. No check before a run starts |
| Inside the container | Full write access, no asking |
| Leaving the container | A fixed alone/ask table (below). Credential scope is the real limit; the hook is a guide |
| Where it runs | Containers we host, one per run, started by `apps/agent` on the same VPS as the API and Postgres |
| Harness | Claude Agent SDK, its model calls through Vercel AI Gateway's Claude Code endpoint. Fallback: the Claude Code CLI run headless on the same endpoint |
| Run state | Owned by the hub API as `modules/agent`; `apps/agent` is a worker that talks only to the API |
| Pickup | As soon as a task is marked, up to 3 at once, oldest first; a task with a later due time waits for it |
| Limits | A cost cap and a running-time cap per run; the Gateway key's monthly budget behind them |
| Attribution | None. A run token decides what a run may call; its writes are not logged as the run's |
| When it ends | The agent completes the task and leaves a report. A failure becomes "Needs you" in the Queue |
| Waiting on you | Suspend and resume: the container stops, the workspace and session are kept, your answer resumes it |
| Connections | Listed on each task, starting from a default set; the agent may request more mid-run |
| While running | Watch the live log, send a message, cancel |

**Alone or ask**

| Does it alone | Asks you through the Queue |
| --- | --- |
| Anything inside its container | Messaging people or channels the task didn't come from |
| Hub operations | Merging, or pushing to `main` |
| Reading the web and MCP tools | External writes that can't be undone (Linear, Drive…) |
| Pushing a branch and opening a PR | Spending money, or deleting outside the hub |
| Slack messages, as the bot or as you, to the people and threads the task came from | |
| Filing requests for you | |

## Packages

```
modules/agent         NEW: runs, run events, messages, connection metadata, settings; operations; screens
modules/tasks         + assignee (me | agent); setAssignee
packages/core         + detailPanels in the manifest
packages/server       + service tokens (worker, run); callee undo records; touchItem
apps/api              mounts modules/agent; accepts service tokens on tRPC and /changes
apps/desktop          task detail renders registered detail panels
docker-compose.yml    + agent and docker services for the VPS
apps/agent            NEW: worker. Claim loop, Docker runner, connection store and CLI, model relay, socket relay
packages/agent-runner NEW: inside the container. Agent SDK session, canUseTool hook, hub MCP server, request_connection
```

**How they talk**

- The desktop app talks only to the API, as today.
- `apps/agent` talks only to the API, with a **worker token**, and to Docker on its own host.
- The runner in a container talks only to `apps/agent`, over a Unix socket mounted into the container: events, permission checks, grant requests, model calls and hub operations. `apps/agent` calls the API for hub operations with that run's **run token**, which it holds; the container never holds a hub token, the worker token, the Gateway key or another run's secrets.

## Core changes

Already in place and used as they are: operation calls (`w.call`, one level deep, queries included), and the Queue's `agent` source and actions on requests. A request the agent files has `externalId` `<runId>:<seq>`, the event that raised it, so a retried `suspend` files once. `fail` files with `<runId>:fail:<n>` (see Run lifecycle).

**Service tokens.** Today a request carries a Google session. Two more kinds of principal, both signed by the API and accepted by the tRPC context and `/changes`:

- **Worker token:** configured on the agent host. Calls only `agent` worker operations, and may listen on `/changes`.
- **Run token:** minted by `agent.claim` for one run, revoked when the run leaves `running`. Calls hub operations marked for AI, with their usual effects. It may not call `agent` operations other than through the worker.

A token is a random 32-byte base64url string, stored only as its SHA-256 hash. A revoked or unknown token is `UNAUTHORIZED`.

**Who may call an operation.** `OperationDescription.access` is `"everyone" | "user" | "worker"`.

| `access` | Callable by |
| --- | --- |
| `everyone` | You or a run |
| `user` | Only you |
| `worker` | Only the worker token |

- Left out, it is `everyone` when `ai !== false` and `user` otherwise.
- `describeOperation` refuses `access: "worker"` unless `palette: false` and `ai: false` are both set.
- Operation calls skip the access check: a callee runs as its caller already ran.
- A token calling an operation it may not is `FORBIDDEN`.
- Agent's own operations that are AI-callable set `access: "user"`, so a run can't start, cancel or reassign runs.

**Principal.** `Context` keeps `session` (yours, unchanged) and gains `principal: Principal | null`: `{ kind: "user"; session }`, `{ kind: "worker"; tokenId }` or `{ kind: "run"; tokenId; runId }`. `protectedProcedure` stays person-only.

**Callee undo records.** Today Undo deletes the items a called operation created but leaves its updates. `UndoToken` becomes `{ record, created, calls: [{ operation, record }] }`: each called mutation's undo record is kept in call order. `ops.undo` runs, in one transaction, the caller's own undo, then each callee's undo in reverse order, then deletes the created items. If any item changed since, the whole Undo is `CONFLICT` "Changed since" and reverts nothing. Queue's `makeTask` gets this too: `tasks.create`'s undo is a no-op, so reopening the request doesn't need the task deleted first. A caller must not touch an item after a callee updated it in the same mutation, or the callee's undo conflicts.

**Detail panels.** `defineModule` takes `detailPanels: [{ itemType, id, component, order? }]`. An item page renders the panels registered for its type, sorted by `order`, so Tasks shows the Agent panel without importing agent code.

**Touching an item.** `w.touchItem(id)` bumps an item's version and publishes it to `/changes`, with no `expectedUpdatedAt`. Run state changes use it; it changes no field, so it never conflicts with your edits. It needs the `touchItems` effect on the operation, which AI may not run without asking first.

**Called or not.** A called operation's writer has `viaCall: true`; a top-level run's has none. A module uses it to allow a write only through another operation: `requests.file` refuses `actions` unless it is called (`BAD_REQUEST` "Only an operation call may file with actions"), so you and a run token file only plain requests, while the agent's `suspend` and `fail` attach Approve, Decline and Retry. Any `source` may still file directly; pre-filing the agent's own `externalId` makes `suspend` and `fail` `CONFLICT`. Undo skips a caller whose own record is null and still reverts its callees.

## Run lifecycle

**Making an AI task.** `agent.assign({ id, expectedUpdatedAt, connections? })`, on the task on screen, calls `tasks.setAssignee` with `agent`, stores the connections (the default set when left out) and queues a run, in one transaction. Given connections must exist and not be disabled, else `BAD_REQUEST` "Unknown or disabled connection". A task with a live run is `CONFLICT` "The agent already has this task". If the task's latest run failed, its open "Needs you" is resolved as `handled`, so its Retry doesn't outlive the new run.

- **Touch.** `assign` does not touch the task when `setAssignee` bumped it: a touch after a callee's update would make the callee's undo conflict. When the task was already the agent's, `setAssignee` changes nothing, so `assign` touches the task to show the new run, and its Undo touches it too. `assignRequest` never touches: its task is new.
- **Undo.** Deletes the queued run and restores the assignment's connections, then the callee records reopen the "Needs you" and set the assignee back. Once the run has been claimed it is `CONFLICT` "Changed since".
- **Back to me.** `agent.unassign({ id, expectedUpdatedAt })` locks the live run, sets the assignee back to `me` and cancels the run, resolving the approval or grant it waited on as `handled`. With no live run, it resolves the latest run's open "Needs you" instead. Its Undo puts a cancelled run back as it was (see Cancel), reopens the request and gives the task back to the agent. With no live run, Undo only reverts the callees.

**Give to agent.** From a request, `agent.assignRequest({ id, expectedUpdatedAt, title?, notes?, connections? })`, on the request on screen, makes the task through `tasks.create` (the request's title and body by default), calls `tasks.setAssignee`, resolves the request as `task` through `requests.resolve`, stores the request's id on the assignment (`request_id`), and queues a run, in one transaction. Each is a direct call, so calls stay one level deep. Connections are checked as for `assign`. Its Undo deletes the queued run, reverts `requests.resolve` and `tasks.setAssignee` through their callee undo records and soft-deletes the task. Once the run has been claimed the Undo is `CONFLICT` "Changed since", reverting nothing.

```
queued → running → done
            │  ↘ failed ("Needs you")
            ↓
         waiting (suspended: approval or grant) → queued (on your answer) → running
cancelled from queued, running or waiting
```

- **Claim.** The worker listens on `/changes` with its worker token and calls `agent.claim` when a task changes, and every 30 seconds as a fallback. It gets the oldest queued run whose task is open (`completed_at` is null), still assigned to the agent and due by now (or has no due time), while fewer than the parallel limit (3) are running. The claim moves it to `running`, mints its run token and returns what the container needs, including the request the task came from, read with `requests.get` on the assignment's `request_id`. A task made with Make task and then assigned has no `request_id`, so no quoted request.
  - Claims are serialised by `pg_advisory_xact_lock(hashtext('agent.claim'))`, so the parallel limit can't be overshot.
  - Before choosing a run, `claim` sweeps: running runs with no heartbeat for 2 minutes go back to `queued` and their tokens are revoked; events of runs that ended more than 30 days ago are deleted; a queued or waiting run whose task was completed, deleted or unassigned is cancelled.
  - If the run has a `decision` not yet delivered, `claim` returns it for the next message and sets `decision.delivered = true`. It does not clear `decision`.
  - `claim` returns `lastSeq`: the highest of the run's event `seq`, `pending.seq` and `decision.seq`, or 0. A resumed session numbers its events after it.
- **Done.** The runner's last step is `finish`: the report is written and the task completed through `tasks.complete`, in one transaction.
- **Sent again.** A lost answer or a host restart can repeat a worker call, so these are no-ops that return the run: `suspend` when the run already waits with `pending.seq` equal to its `seq`; `finish` when the run is `done`; `fail` when it is `failed` with a failure pending. `suspend` and `fail` refuse a request already filed under the run's next `externalId` (`requests.file` returned `existing: true`) with `CONFLICT`: this run didn't file it.
- **Failed.** A crash, a timeout, a cap, a Gateway refusal, or the agent saying it is stuck. `fail` files a request "Needs you: \<task\>" with the reason and a Retry action (`agent.retry` with input `{ id: <taskId> }`), with `externalId` `<runId>:fail:<failures + 1>`, and increments `failures`, so a retried `fail` files once. The workspace is kept, so Retry resumes the session. Retry resolves the run's open failure request as `handled` through `requests.resolve`, which is what `requests.file` requires of an action's operation. Retry after Back to me is `CONFLICT` "This task is back with you"; Make AI task again instead.
- **Waiting.** `suspend` records the session id, files the approval or grant request and moves the run to `waiting`; the worker stops the container. A grant names its `connectionId`, else `BAD_REQUEST`. Your answer through `decide` stores `decision` and queues the run again; the next claim starts a container on the same workspace, resumes the session and sends your decision as the next message.
- **Heartbeat.** A running run's worker calls `heartbeat` every 30 seconds. A run with no heartbeat for 2 minutes goes back to `queued` and resumes from its session; the sweep in `claim` does this. `heartbeat` returns `{ stop: boolean }`: when the task is completed, deleted or no longer assigned to the agent, it sets the run to `cancelled`, revokes its token and returns `stop: true`, so Tasks needs no hook into Agent. `finish` after that is `CONFLICT` and does not complete the task twice.
- **Limits** (settings): a cost cap of $10 and 240 minutes of running time per run. Reaching one fails the run with the reason ("Cost cap reached ($10.00)"); Retry continues with a fresh allowance. Each heartbeat adds the time since the last one to `running_ms`, and `claim` resets `heartbeat_at`, so time queued or waiting doesn't count. The time cap compares `running_ms`; the cost cap compares `cost_usd − cost_base_usd`. Retry sets `running_ms` to 0 and `cost_base_usd` to `cost_usd`. Turns and tokens are counted for display only. A monthly budget on the Gateway key is the last limit. The defaults are revisited after the Gateway check.
- **Pending.** `pending` is the open request a run filed. `suspend` sets it (approval or grant) and `fail` sets it (failure). `decide` clears it. Cancel, Back to me and a cancelling sweep resolve an approval or grant as `handled` and clear it. Retry resolves a failure and clears it. Make AI task and Back to me with no live run resolve a failure but keep `pending`, so Undo's reopened request still matches it.
- **Undo of run actions.** Cancel, Back to me, Retry and `decide` keep the run as it was, and their Undo puts it back. Each conflicts with "Changed since" if a claim has run since (`heartbeat_at` changed), or the run is no longer in the state the action left. Cancel's and Back to me's also need the run to still be the task's latest, with no live run: a run that was running goes back to `queued`, since its container stopped. Retry's puts the run back to `failed` or `cancelled` with its allowance. `decide`'s puts the run back to `waiting` with its connections. Callee records then reopen the request.
- **Your changes to the task.** Completing, deleting or unassigning a task mid-run cancels the run, at the next `heartbeat` for a running run and at the next `claim` for a queued or waiting one. Deleting the task removes its runs by cascade, and the workspace goes on its 7-day timer.

## Data model

**Tasks.** `tasks.assignee` text, not null, default `me`, check `me` or `agent`, on a table that has no status column (a task is open while `completed_at` is null). Set only by `tasks.setAssignee`, which is off for ⌘K and AI, has an undo record, and is called by `agent.assign`, `agent.assignRequest` and `agent.unassign`.

**`modules/agent`.** Runs are not Core items. Every change to a run's state also touches its task (`w.touchItem`), so `/changes` refreshes the screens. Event appends do not bump it.

| Table | Columns | Notes |
| --- | --- | --- |
| `agent_assignments` | `task_id` (FK `items`, cascade), `connection_ids` uuid[], `request_id` uuid null | The connections a task starts with. `request_id` is set by `assignRequest`; `claim` reads the request with `requests.get` on it. Null for a task made with Make task |
| `agent_runs` | `id`, `task_id` (FK `items`, cascade), `status`, `session_id`, `workspace`, `connection_ids`, `pending`, `decision`, `failures`, `heartbeat_at`, `created_at`, `started_at`, `finished_at`, `failure_code`, `failure_message`, `report` jsonb, `turns`, `input_tokens`, `output_tokens`, `cost_usd`, `cost_base_usd`, `running_ms`, `image` | `status`: `queued`, `running`, `waiting`, `done`, `failed`, `cancelled`. `connection_ids` is the start set plus grants. `pending` is `{ requestId, seq, kind: "approval" \| "grant" \| "failure", connectionId?, tool?, inputHash? }`, the open request the run filed. `decision` is `{ seq, approve, delivered }`, set by `decide` and marked `delivered` by the `claim` that hands it over. `failures` int, default 0, counts `fail` calls. `started_at` is the first start. `running_ms` int and `cost_base_usd` numeric(10,4), both default 0, are the current allowance (see Limits). `image` is the digest it ran on. Unique on `task_id` where `status` is `queued`, `running` or `waiting` |
| `agent_run_events` | `run_id`, `seq`, `at`, `kind`, `data` jsonb | `kind`: `text`, `tool`, `tool_result`, `file`, `permission`, `status`. Primary key `(run_id, seq)`. Removed 30 days after the run ends |
| `agent_run_messages` | `id`, `run_id`, `at`, `body`, `delivered_at` | Your messages; `delivered_at` set when the runner takes them. Indexed on `run_id` |
| `agent_connections` | `id`, `name`, `type`, `scope_summary`, `created_at`, `disabled_at` | `type`: `github`, `aws`, `slack`, `linear`, `gdrive`, `mcp`, `env`. Metadata only |
| `agent_settings` | One row: `default_connection_ids`, `max_parallel` (3), `max_running_minutes` (240), `max_cost_usd` (10), `time_zone` (`UTC`), `instructions` | A module table, like Core's `ai_settings`. `time_zone` reads all-day due dates for "due by now"; Settings → Agent sets it. It must be a zone `Intl` knows, and `max_cost_usd` at least 0.01, else `BAD_REQUEST` |

`report` is `{ summary, links: [{ label, url }], filesChanged: string[] }`.

## Operations (Agent)

An operation's id is `<module>.<key>`, so every name below is flat: `agent.assign`, `agent.connections`, `agent.settings` and so on.

| Operation | Kind | Input | ⌘K | AI |
| --- | --- | --- | --- | --- |
| `assign` | mutation | `{ id, expectedUpdatedAt, connections? }` | "Make AI task" | ✓ (suggests) |
| `assignRequest` | mutation | `{ id, expectedUpdatedAt, title?, notes?, connections? }` | "Give to agent" on a request | ✓ (suggests) |
| `unassign` | mutation | `{ id, expectedUpdatedAt }` | "Back to me" | ✓ |
| `message` | mutation | `{ runId, body }` | "Tell the agent…" | ✗ |
| `cancel` | mutation | `{ id }` | "Cancel run" | ✓ |
| `retry` | mutation | `{ id }` | "Retry run" | ✓ |
| `decide` | mutation | `{ runId, seq, approve }` | ✗ | ✗ |
| `run` | query | `{ runId }` | ✗ | ✗ |
| `runs` | query | `{ taskId }` or `{ status? }` | ✗ | ✗ |
| `events` | query | `{ runId, after? }` | ✗ | ✗ |
| `connections` | query | `{}` | ✗ | ✗ |
| `setDefaultConnections`, `disableConnection` | mutation | `{ id, … }` | ✗ | ✗ |
| `settings` / `setSettings` | query / mutation | — / partial settings | ✗ | ✗ |

- `id` is the item on screen: the task, or the request for `assignRequest`. AI fills only `id` and `expectedUpdatedAt` from the screen, so `cancel` and `retry` take the task and act on its most recent run.
- `assign` and `assignRequest` declare the `touchItems` effect, which caps AI at suggest: AI proposes giving a task to the agent and you confirm.
- `runs` is the panel's run history, so it is off for AI: an AI list returns item summaries, not runs.
- `message` is refused unless the run is `running` or `waiting`; a message to a waiting run is delivered on resume.
- `cancel` stops the container and keeps the workspace, and resolves an approval or grant the run waited on as `handled`. `retry` queues a `failed` or `cancelled` run again with the same session and a fresh allowance, and resolves the run's open failure request as `handled` (it declares `calls: [tasks.get, requests.get, requests.resolve]`).
- An operation declares every operation it calls, queries included: `assign` and `unassign` call `tasks.setAssignee`, `requests.get` and `requests.resolve`.
- AI-callable agent operations set `access: "user"`: a run token gets `FORBIDDEN` on them.
- `decide` records the answer as `decision` `{ seq, approve, delivered: false }`, resolves the request through `requests.resolve` (outcome `handled`) and queues the run. The request is filed after the event, so its actions name the event `seq`, not a request id. A `seq` that isn't the run's current `pending.seq` is `CONFLICT`. When the stored `decision` has the same `seq` and answer it is a no-op; the same `seq` with a different answer is `CONFLICT`. It is the operation behind the Approve and Decline actions.
- `events` returns events after `seq`, at most 500.

**Worker operations** take only the worker token, and are off for ⌘K and AI: `claim`, `heartbeat` (returns `{ stop }`), `appendEvents` (batched), `takeMessages`, `suspend({ runId, sessionId, request })`, `finish({ runId, report })`, `fail({ runId, code, message })`, `registerConnection` (used by the CLI). They have `access: "worker"`. `suspend` and `fail` file their request through `requests.file`.

## Containers

**Host.** One always-on VPS, 8 vCPUs and 16 GB, running Postgres, `apps/api` and `apps/agent` with Docker through `docker-compose.yml`. That fits 3 runs at 2 CPUs and 4 GB each, with room for the API and Postgres. The worker reaches the API over the compose network; run containers are on their own network and can't reach it. This also settles the overview's hosting question, so Slack intake can run here. One image, `dlh-agent-runner`: Node, pnpm, Python, git, `gh`, the AWS CLI, the Agent SDK and `packages/agent-runner`. Built by `pnpm agent:image`; each run records its digest.

**Per run**

- A volume `dlh-ws-<runId>` at `/workspace`: repos, files and the SDK's session data, so resume works. Removed 7 days after the run ends; a Retry after that starts a fresh session.
- Limits from settings: 2 CPUs, 4 GB of memory, a process limit.
- Non-root, not privileged, no Docker socket, a read-only root apart from `/workspace` and `/tmp`.
- Network open to the internet. The host's private network and the cloud metadata address are blocked.
- The `apps/agent` socket mounted at `/run/dlh.sock`.

**Model relay.** The container's `ANTHROPIC_BASE_URL` points at `apps/agent` over the socket. The relay adds the Gateway key, forwards to Vercel AI Gateway's Claude Code endpoint, counts turns, tokens and cost onto the run, and fails the run at its cost cap. A `429` waits and retries up to 3 times.

**Hub MCP server.** Runs in the runner and exposes hub operations (those marked for AI) as tools. Calls go over the socket to `apps/agent`, which calls the API with the run token.

## Connections

**Adding one.** On the agent host: `pnpm agent connection add <type> "<name>"`. It prompts for the secret, so the secret stays out of shell history, stores it in `apps/agent`'s store, and registers the metadata through `registerConnection`. The store is a SQLite file on the host, encrypted with `AGENT_SECRETS_KEY` from the host's environment. The API and the desktop app never see a secret; Settings lists connections, sets the default set and disables one.

**Into a run**

| Type | Inside the run |
| --- | --- |
| `github` | A fine-grained token limited to listed repos, through a git credential helper and `GH_TOKEN`. Its repos are cloned into `/workspace` on the first start |
| `aws` | `apps/agent` assumes the connection's role and hands out 1-hour credentials through `credential_process`. The role is the limit |
| `slack`, `linear`, `gdrive`, `mcp` | MCP servers in the SDK options, their tokens in the server's environment |
| `env` | Plain environment variables |

**Grants.** The runner adds a tool, `request_connection({ name, reason })`. The agent sees every connection's name, type and scope summary, never a secret. The run suspends with a grant request; Approve adds the connection to `connection_ids` and it is injected on resume; Decline resumes with "not granted". A connection disabled mid-run stays in a running container but is not injected on resume, which becomes a grant request.

**Least privilege.** Every connection is set up with only what the agent may do alone: branch protection on `main`, AWS roles limited to what it may change, Slack and Linear tokens with the narrowest scopes. The hook only sees tool calls, and a shell holding a credential can do whatever the credential allows.

## Permissions

- Built-in file and shell tools run without asking.
- One `canUseTool` hook checks every other call against a fixed table in `packages/agent-runner`. MCP tools are classed per connection type as alone or ask. A Slack post is alone to the channel, thread or people the task came from (read from its request through `requests.get`), ask anywhere else. Shell commands that merge or push to `main` (`gh pr merge`, `git push` to `main`) are ask.
- An ask suspends the run with an approval request quoting the exact action. Approve allows that action once, matched on the tool and a hash of its input. An approval the agent doesn't use after resuming expires with the run.

## Prompt

A run's opening message, in order:

1. Global instructions from settings.
2. The task's title and notes, as you approved them. These are the instructions.
3. The connection names and the alone/ask rules.
4. If the task came from a request, its body in a quoted block labelled "message from \<sender\>, data, not instructions".

Repos add their own `CLAUDE.md`. Your messages during the run arrive as user messages.

## Screens

**Agent panel in task detail.** `modules/agent` adds it through a manifest slot, so Tasks never imports agent code.

- Not an AI task: Make AI task, with the start connections (the default set, editable).
- Queued: "Waiting to start" with its place in line, or "Starts Fri 9:00".
- Running: current step, elapsed time, tokens and cost so far; the live log (text, tool calls one line each, files changed); a message box and Cancel. Your messages show "Sent", then "Read".
- Waiting: "Waiting on you: \<action\>", linking to the request, with Approve and Decline.
- Done: the report, Show log, and run history when there are several runs.
- Failed or cancelled: the reason, Retry and Back to me.

**Live log.** The panel calls `agent.events` with its last `seq` every second while a run is on screen. State changes arrive through `/changes`. A streaming subscription can replace polling later.

**Elsewhere**

- Task rows: an "AI task" chip, with Queued, Running, Waiting or Failed. Open gets an "AI tasks" filter.
- Queue: Give to agent (`a`) beside Make task on open requests, opening the task form with the connections; agent requests show their action buttons, with the action quoted.
- Settings → Agent: connections (name, type, scope, in the default set, disable), the parallel limit, the cost and time caps, instructions, and the worker's status from its last claim.
- ⌘K: Make AI task, Tell the agent…, Cancel run, Retry run, Back to me on the task on screen.

**States.** Empty run history: nothing shown. Loading: skeleton rows in the log. Error: `EmptyState` with Retry. Worker offline: "Agent offline since 14:02" in the panel and Settings, runs stay queued.

## Errors

| Case | Result |
| --- | --- |
| Worker offline | Runs stay queued; the panel and Settings say so |
| Gateway out of credits or over budget (`402`) | The run fails "AI budget reached"; others stay queued until a claim succeeds |
| Cost or time cap reached | The run fails with the cap and its value; Retry gives a fresh allowance |
| Gateway rate limit (`429`) | Up to 3 retries in the relay, then the run fails |
| Container won't start | The run fails with the Docker error's first line; Retry |
| Workspace removed before a Retry | A fresh session on a fresh workspace |
| Task completed, deleted or unassigned mid-run | The run is cancelled |
| `decide` on an answered request | No-op for the same `seq` and answer, `CONFLICT` for a different answer |
| `decide` with a `seq` that isn't the run's pending one | `CONFLICT` |
| `finish` after the run was cancelled | `CONFLICT`; the task is not completed |
| `suspend`, `finish` or `fail` sent again | No-op; the run as it is |
| A request already filed under the run's next id | `suspend` and `fail` are `CONFLICT` |
| Retry after Back to me | `CONFLICT` "This task is back with you" |
| Make AI task while a run is live | `CONFLICT` "The agent already has this task" |
| Unknown or disabled connection | `BAD_REQUEST` "Unknown or disabled connection" |
| A run token calls an operation it may not | `FORBIDDEN`; a revoked token is `UNAUTHORIZED` |
| `message` to a run that has ended | `BAD_REQUEST` "This run has ended" |

## Testing

- **Unit:** claim rules (parallel limit, due time, oldest first, one active run per task); state transitions, with every illegal one refused; the permission table, including where-it-came-from for Slack and the `main` push patterns; approval matching on tool and input hash; the prompt, with a request body quoted as data.
- **Core (`test:db`):** Undo of a mutation that called another reverts both, callee last-first, and conflicts as a whole if either item changed; a worker token is refused by user-only operations and a run token by worker operations; `touchItem` publishes without a version check.
- **Core (`test:db`), more:** Undo of a caller with a null record still reverts its callees, from `ops.undo` and from an AI follow-up's Undo; a callee's writer has `viaCall` and a top-level run's doesn't; `ops.undo` refuses worker and run tokens.
- **Database (`test:db`):** two workers claiming at once get different runs; a missed heartbeat returns the run to `queued`; `assign` and `unassign` through operation calls, with Undo; `finish` completes the task in one transaction; `decide` resolves the request and queues the run; events removed after 30 days; run tokens revoked when a run leaves `running`.
- **Database, more:** Undo of Back to me on a failed run sets the assignee back; Make AI task and Back to me resolve a failed run's "Needs you" and Undo reopens it; assigning a task the agent already has publishes the new run; unknown or disabled connections are refused; `suspend`, `finish` and `fail` sent twice act once; a request pre-filed under the run's next id makes `suspend` and `fail` `CONFLICT`; a grant without a connection is refused; `requests.file` with actions is `BAD_REQUEST` from you or a run token and works through an operation call; `claim` returns `lastSeq`; Undo of cancel, Back to me, Retry and `decide` restores the run, and conflicts after a claim; Retry after Back to me is `CONFLICT`; caps count running time only, and Retry resets them; settings refuse an unknown time zone and a cost cap under a cent.
- **Relay:** token and cost counting; the cost cap fails the run; `429` retries; the Gateway key absent from the container's environment.
- **Container (needs Docker):** a fake model replays a scripted session that edits a file, asks to merge, suspends, resumes approved, then finishes; a grant request suspends and resumes with the connection; the container can't reach the metadata address or the API directly; no secret in the image or the log.
- **Gateway check:** one real Agent SDK run through the Gateway's Claude Code endpoint, seen in the Gateway logs, then resumed from its session volume in a fresh container. Manual, with your key, once.
- **End to end (Playwright, fake model):** Make AI task, watch it run, send a message, approve a merge from the Queue, see the task done with its report.

## Build order

Several PRs, in this order:

1. The Gateway check (throwaway): an Agent SDK run through the Gateway, and its session resumed from a volume in a new container. If the SDK doesn't run through the Gateway, switch the harness to the Claude Code CLI headless; if the session doesn't resume from the volume, the runner saves and restores it explicitly. Note the real cost of a typical run for the cap defaults.
2. Core: service tokens, callee undo records, detail panels, `touchItem`.
3. `modules/agent` server and `tasks.assignee`: tables, operations, claim rules, database tests.
4. `apps/agent`: worker, connection store and CLI, model relay, Docker runner, and the compose services for the VPS.
5. `packages/agent-runner`: SDK session, hook, hub MCP server, grants, suspend and resume.
6. Screens: the Agent panel, row chips, Queue action buttons, Settings.
7. End to end, docs, and the manual Done check.

## Resolved questions

- **The agent host:** the same always-on VPS as the API and Postgres, 8 vCPUs and 16 GB, through docker-compose (Containers → Host).
- **Caps:** a cost cap ($10) and a time cap (240 minutes) per run, no turn or token caps; defaults revisited after the Gateway check.
- **Session resume from a volume:** checked in step 1, with an explicit save and restore as the fallback.
