# Agent Hub, Part 2: the Worker and the Runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build steps 4–5 of the Agent Hub build order.

- `apps/agent` is the worker: claim loop, connection store and CLI, model relay, Docker runner and the VPS compose file.
- `packages/agent-runner` runs inside a container: the Agent SDK session, the permission hook, hub tools, grants, and suspend and resume.

When this lands, a task marked for the agent runs in a container to a report, asks through the Queue when it must, and resumes after your answer. Done checks 2–5 can be shown with a fake model; check 1 waits for Part 3's screens.

**Architecture:**

- **The worker** talks to the API with its worker token and to Docker through the `docker` CLI.
- **Each run** gets its own container, workspace volume and Unix socket. The socket is the run's only way out: model calls, events, messages, hub operations, credentials, suspend and finish.
- **The worker holds the run token and every secret.** The container holds neither.
- **The runner** is a Node program in the `dlh-agent-runner` image. It drives one Agent SDK session per container start, resuming from the volume after a suspend or a restart.

**Tech Stack:** TypeScript, Node 22.13+ (`node:sqlite`, `node:crypto`), `@anthropic-ai/claude-agent-sdk`, tRPC HTTP client, Docker CLI, Vitest.

**Spec:** `docs/specs/agent-hub.md`, including its "Gateway check results" section (PR #35). Read it with:

- `docs/superpowers/plans/2026-11-04-agent-hub-core.md` (Part 1);
- its rulings R1–R24. Contract points Part 2 must honour: R22 (`lastSeq`, idempotent worker calls), R24 (stop a container on any worker-call error), and that hub tools leave out `access: "user"` operations.

**Decisions made while planning**

Task 1 writes each of these into the spec.

- **D1. What `claim` returns grows.**
  - New fields: `instructions` (from settings) and `connections`, meaning every connection that isn't disabled, as `{ id, name, type, scopeSummary }` (for the prompt and for grants).
  - The request gains `source` and `sourceUrl` (for the Slack rule).
  - `claim` also records `agent_settings.worker_seen_at`, which Settings shows in Part 3.
  - `heartbeat` takes an optional `image` (the digest) and an optional `sessionId`, and stores both on the run.
  - Without `sessionId`, a run restarted before its first suspend would start over.
- **D2. One socket per run.**
  - The worker serves HTTP on a Unix socket at the host path `/var/lib/dlh-agent/runs/<runId>/dlh.sock`.
  - The directory is mounted at `/run/dlh`, so inside the container the socket is `/run/dlh/dlh.sock`.
  - Which socket a request arrives on tells the worker which run it's from. There is no token inside the container.
- **D3. A loopback forwarder.** The SDK needs an `http://` base URL, so the runner forwards `127.0.0.1:8788` to the socket and sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8788/model`. `ANTHROPIC_AUTH_TOKEN` is the fixed placeholder `dlh-run`; the relay replaces it with the Gateway key.
- **D4. The relay prices usage itself.**
  - Prices come from `https://ai-gateway.vercel.sh/v1/models` (`pricing.input`, `output`, `input_cache_read`, `input_cache_write`, in dollars per token), cached for an hour.
  - Mapping a model: strip a trailing `-YYYYMMDD`, then turn the last `-N-M` into `-N.M` and prefix `anthropic/` (`claude-opus-5-5` → `anthropic/claude-opus-5.5`). A model with no price uses the most expensive `anthropic/*` price in the list.
  - Each heartbeat sends `costUsd` = the run's `costUsd` at claim plus this container's priced usage, so the total is cumulative across containers.
- **D5. No secret in a container's configuration.** `docker inspect` must show no secret. Each connection type gets its secret another way:
  - `github`: a git credential helper (`dlh-credential`) and a `gh` wrapper, both asking the socket for the token on each use.
  - `aws`: `credential_process` calling `dlh-credential aws <name>`.
  - `slack`, `linear`, `gdrive`, `mcp`: MCP servers the runner starts, with their tokens in those processes' environment only.
  - `env`: set only in the SDK child process's environment.
- **D6. Hub tools come from the module descriptions.**
  - `scripts/gen-modules.ts` also writes `packages/agent-runner/src/modules.gen.ts`, importing each module's `src/module.ts`.
  - The runner exposes every operation whose `accessOf(desc)` is `"everyone"` as an MCP tool `hub__<module>_<key>`.
  - A call goes over the socket; the worker POSTs it to `/trpc/<id>` (a query is a GET) with the run token.
- **D7. Ending a run.**
  - The runner adds `finish_task({ summary, links })`. The runner adds `filesChanged` from `git status --porcelain` in each repository under `/workspace`, then calls finish.
  - It also adds `give_up({ reason })`, which fails the run with `code: "stuck"`.
  - A session that ends without either fails with `code: "no_report"`, message "Ended without a report".
- **D8. The runner remembers what it asked.**
  - Before suspending, the runner writes `/workspace/.dlh/pending.json`: `{ seq, kind, tool?, inputHash?, connectionName?, action }`.
  - On resume, a claimed `decision` with that `seq` becomes the next user message:
    - approved action: "Approved: <action>. Go ahead.", and that tool and input hash are allowed once;
    - declined action: "Declined: <action>. Don't do it another way.";
    - approved grant: "Granted: <name>.";
    - declined grant: "Not granted: <name>."
- **D9. Messages.** The worker calls `takeMessages` every 5 s for each live run and queues the messages on the run's socket. The runner long-polls `GET /messages` and feeds them into the SDK's streaming input.
- **D10. Restarts and cleanup.**
  - On start, the worker stops and removes every `dlh-run-*` container. Their runs miss heartbeats, the API's stale sweep requeues them, and the next claim resumes them from their sessions.
  - The worker's SQLite file keeps a `runs` table (`run_id`, `volume`, `ended_at`). Each hour it removes volumes that ended more than 7 days ago.
- **D11. Docker is a CLI behind an interface.** A `Docker` interface (`run`, `stop`, `remove`, `inspect`, `listRunContainers`, `removeVolume`, `imageDigest`) has an `execFile` implementation and a fake for tests.
- **D12. VPS compose.** `deploy/vps/docker-compose.yml` runs `db`, `api` and `agent`. The root `docker-compose.yml` stays the dev database.
- **D13. Docker tests.** They run only with `DLH_DOCKER_TESTS=1`. The CI `server` job (Ubuntu, Docker available) sets it.
- **D14. Errors stop containers (R24).**
  - Network errors get one retry.
  - After that, any error from `heartbeat`, `suspend`, `finish` or `fail` makes the worker stop the run's container and mark it ended locally. The API's stale sweep then requeues the run.
  - `heartbeat`'s `{ stop: true }` stops it too.

## Global Constraints

- Gateway: base `https://ai-gateway.vercel.sh/claude-code`. In the container `ANTHROPIC_API_KEY` is empty (it must be, or it overrides the token). The real key reaches only the relay, from `AI_GATEWAY_API_KEY` in the worker's environment.
- Container: user 1000:1000, `--read-only` with `--tmpfs /tmp`, `--cpus 2`, `--memory 4g`, `--pids-limit 512`, `--cap-drop ALL`, `--security-opt no-new-privileges`, network `dlh-runs`, volume `dlh-ws-<runId>` at `/workspace`, `CLAUDE_CONFIG_DIR=/workspace/.claude`, name `dlh-run-<runId>`, label `dlh.run=<runId>`. No Docker socket.
- Blocked from `dlh-runs`: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` and `100.64.0.0/10`, outbound.
- Worker timings: claim on a `/changes` event and every 30 s; heartbeat every 30 s per run; `takeMessages` every 5 s; `appendEvents` at most 200 per call, flushed every 2 s; relay `429` retried up to 3 times (1 s, 2 s, 4 s); volumes kept 7 days.
- Secrets store: `AGENT_SECRETS_KEY` is 32 bytes, base64. Values are encrypted with AES-256-GCM, with a random 12-byte nonce per value. The file is `/var/lib/dlh-agent/agent.db`.
- Copy (verbatim): "Ended without a report" · "AI budget reached" (Gateway `402`) · "Rate limited by the AI Gateway" (`429` after retries) · "Container didn't start: <first line>" · "Approved: <action>. Go ahead." · "Declined: <action>. Don't do it another way." · "Granted: <name>." · "Not granted: <name>."
- The container never holds the worker token, a run token, the Gateway key or a connection secret in its configuration, image or logs.
- Modules still never import `@dlh/db`. `apps/agent` reaches hub data only through the API.

## Review Focus

1. **A secret leaking into a container.** `docker inspect dlh-run-<id>` env, the image layers, the events sent to the API and the runner's stdout contain neither the Gateway key nor a connection secret. Test: Task 10 `no secret in the container's config, image or events`.
2. **The agent pushing to `main` some other way.** `git push origin HEAD:main`, `git push -f origin main`, `git push origin main:main`, `gh pr merge --admin` and `gh api -X PUT repos/…/merge` are all asks; `git push origin feature` isn't. Test: Task 8 `main pushes and merges are asks in every spelling`.
3. **Approve answering a different action.** An approval allows only the exact tool and input hash, once. The same tool with another input is still an ask after the approval. Test: Task 8 `an approval allows that exact action once`.
4. **The worker restarting mid-run.** After a restart the run resumes from its session. It doesn't start over, and events continue after `lastSeq` with none lost or duplicated. Test: Task 10 `a worker restart resumes the run from its session`.
5. **A model call the relay can't price.** An unknown model is charged at the most expensive Anthropic price, never zero, so the cost cap still bites. Test: Task 4 `an unknown model costs the highest Anthropic price`.

## File structure

```
modules/agent/                         + claim fields, heartbeat image, worker_seen_at (drizzle/0001_worker.sql)
packages/agent-protocol/               NEW: zod schemas for the socket routes, shared by worker and runner
apps/agent/                            NEW @dlh/agent
  src/main.ts                          start: config, cleanup, claim loop, sweeps
  src/config.ts                        env: API_URL, AGENT_WORKER_TOKEN, AI_GATEWAY_API_KEY, AGENT_SECRETS_KEY, AGENT_DATA_DIR, AGENT_GATEWAY_URL
  src/api.ts                           tRPC HTTP client (worker token; run token per call), /changes listener
  src/store.ts                         node:sqlite: connections (encrypted), runs (ended_at)
  src/cli.ts                           pnpm agent connection add|list|remove
  src/relay/{prices,relay}.ts          model relay and pricing
  src/docker/{docker,cli}.ts           Docker interface + execFile implementation
  src/run/{supervisor,socket,events}.ts one run: container, socket server, heartbeat, messages, events
  src/claimLoop.ts                     claim, parallel bookkeeping, restart cleanup, volume sweep
  test/…  test/fakeAnthropic.ts        scripted Messages API (SSE) for tests
packages/agent-runner/                 NEW @dlh/agent-runner
  src/main.ts                          one session per container start
  src/forwarder.ts                     127.0.0.1:8788 → /run/dlh/dlh.sock
  src/prompt.ts                        opening message
  src/session.ts                       SDK query, streaming input, resume or fresh
  src/permissions.ts                   alone/ask table, input hash, approvals
  src/tools.ts                         hub tools, finish_task, give_up, request_connection
  src/connections.ts                   MCP servers, env, credential wiring
  src/modules.gen.ts                   generated: module descriptions
  bin/dlh-credential, bin/gh           credential helper and gh wrapper (shell, ask the socket)
  Dockerfile                           dlh-agent-runner image
deploy/vps/docker-compose.yml, deploy/vps/runs-firewall.sh, deploy/vps/README.md
scripts/gen-modules.ts                 + the runner's list
```

---

### Task 1: Planning decisions in the spec

**Files:** Modify `docs/specs/agent-hub.md`.

- [ ] **Step 1: Write D1–D14 into the spec where each belongs.**
  - Operations: claim's new fields and heartbeat's `image`.
  - Containers: the socket path, the forwarder, the image contents and the `docker run` flags.
  - Model relay: pricing.
  - Connections: D5.
  - Hub MCP server: D6.
  - Run lifecycle: D7–D10 and D14.
  - Testing: Docker tests are opt-in.
- [ ] **Step 2: Commit** `docs(agent-hub): decisions from planning part 2`

---

### Task 2: What claim hands the host

**Files:**
- Create: `modules/agent/drizzle/0001_worker.sql` (generated)
- Modify: `modules/agent/src/db/schema.ts`, `modules/agent/src/operations.ts` (heartbeat input), `modules/agent/src/schema.ts`, `modules/agent/src/server/worker.ts`
- Test: `modules/agent/test/claim.db.test.ts`, `modules/agent/test/worker.db.test.ts`

**Interfaces:**
- Produces:
  - Claim result fields added:
    - `instructions: string`;
    - `connections: { id, name, type, scopeSummary }[]`, every connection that isn't disabled;
    - `request: { sender, body, source, sourceUrl } | null`.
  - `heartbeat` input gains `image?: string` (`sha256:` digest), stored in `agent_runs.image`, and `sessionId?: string`, stored in `agent_runs.session_id`.
  - Column `agent_settings.worker_seen_at timestamptz null`, set to now by every `claim`. `settings` returns `workerSeenAt: string | null`.

- [ ] **Step 1: Write failing tests:**
  - `claim returns the instructions and every live connection`;
  - `claim returns the request's source and link`;
  - `claim records when the worker was last seen`;
  - `heartbeat stores the image digest once`;
  - `heartbeat stores the session id, and claim returns it after a restart`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/module-agent test:db -- claim worker`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `pnpm --filter @dlh/module-agent generate` and name the file `0001_worker.sql`.
- [ ] **Step 4: Run** the same command, plus `pnpm --filter @dlh/module-agent test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): claim hands the host instructions, connections and the request's source`

---

### Task 3: The protocol package and the worker's skeleton

**Files:**
- Create:
  - `packages/agent-protocol/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
  - `apps/agent/{package.json,tsconfig.json,vitest.config.ts,src/config.ts,src/api.ts,src/main.ts}`
  - `apps/agent/.env.example`
- Test: `packages/agent-protocol/test/routes.test.ts`, `apps/agent/test/api.test.ts`, `apps/agent/test/config.test.ts`

**Interfaces:**
- Produces, in `@dlh/agent-protocol`: zod schemas plus `type`s for each socket route. Every route is JSON over HTTP, except `/model/*`, which passes through.
  - `POST /events` takes `{ events: { at, kind, data }[] }`. The worker numbers them.
  - `GET /messages?wait=25` returns `{ messages: { id, body }[] }`.
  - `GET /run` returns `RunStart = { runId, task, request, instructions, connections, grantedIds, sessionId, decision, lastSeq }`.
  - `POST /hub` takes `{ operation, input }` and returns `{ ok: true, result } | { ok: false, code, message }`.
  - `GET /credentials/:type/:name` returns `{ secret: Record<string,string> }`. It is refused unless the connection is in the run's granted set.
  - `POST /suspend` takes `{ sessionId, kind, title, body, tool?, inputHash?, connectionId? }` and returns `{ seq }`.
  - `POST /finish` takes `{ report }`. `POST /fail` takes `{ code, message }`. `POST /session` takes `{ sessionId }`, the first time a session id is known.
- Produces, in `apps/agent`:
  - `loadConfig(env): Config` validates with zod. Fields: `apiUrl`, `workerToken`, `gatewayKey`, `gatewayUrl` (default `https://ai-gateway.vercel.sh/claude-code`), `secretsKey` (32 bytes base64), `dataDir` (default `/var/lib/dlh-agent`).
  - `createApi(config): WorkerApi` returns `{ worker: typed tRPC client over the agent router with the worker token, asRun(token): { call(id, input, kind) }, onChanges(cb): () => void }`.
  - `onChanges` reads `/changes` SSE with the worker token and reconnects with backoff.

- [ ] **Step 1: Write failing tests:**
  - protocol: `each route schema parses its example and refuses extra fields`.
  - config: `a short secrets key is refused`; `the gateway URL defaults to the Claude Code endpoint`.
  - api: against a stub HTTP server, `the worker client sends the worker token`, `asRun posts a mutation to /trpc/<id> with the run token`, `asRun gets a query`, `onChanges reconnects after the stream drops`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent-protocol test && pnpm --filter @dlh/agent test`. Expected: FAIL.
- [ ] **Step 3: Implement.** The packages follow `apps/api`'s and `packages/core`'s setup. The worker's tRPC client is typed from the agent module's router type (`AgentRouter`, exported like `TasksRouter`).
- [ ] **Step 4: Run** the same commands, plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): protocol package and the worker's API client`

---

### Task 4: The model relay

**Files:**
- Create: `apps/agent/src/relay/prices.ts`, `apps/agent/src/relay/relay.ts`, `apps/agent/test/fakeAnthropic.ts`
- Test: `apps/agent/test/relay.test.ts`

**Interfaces:**
- Consumes: `Config`.
- Produces:
  - `gatewayModelId(model: string): string` implements the D4 mapping.
  - `createPrices(fetch, now): { priceOf(model): Promise<Price> }`, with a 1-hour cache. `Price = { input, output, cacheRead, cacheWrite }` in dollars per token.
  - `createRelay({ gatewayUrl, gatewayKey, prices }): { handle(req, res): Promise<void>; usage(): Usage }`, where `Usage = { turns, inputTokens, outputTokens, costUsd }` for this container.
    - It forwards `/model/<path>` to `<gatewayUrl>/<path>`.
    - It replaces `authorization` and `x-api-key` with `Authorization: Bearer <gatewayKey>`.
    - It streams the body back unchanged and reads usage from SSE `message_start` and `message_delta` events, or from a JSON body's `usage`. One `/v1/messages` call is one turn.
    - `402` → `RelayError("budget", "AI budget reached")`. `429` is retried 3 times, then `RelayError("rate_limited", "Rate limited by the AI Gateway")`.
  - `fakeAnthropic(script: ScriptedTurn[]): { url, close, requests }` is a test server that answers `/v1/messages` with SSE from a script of `{ text?, toolUse?: { name, input }, usage }`.

- [ ] **Step 1: Write failing tests:**
  - `gatewayModelId maps claude-opus-5-5 to anthropic/claude-opus-5.5 and drops a date suffix`.
  - `the container's token is replaced by the Gateway key`.
  - `a streamed response passes through byte for byte`.
  - `usage and cost add up across turns`. With opus-5.5 prices, `{ input 6, cache write 14886, cache read 29169, output 402 }` costs ≈ $0.0883.
  - `an unknown model costs the highest Anthropic price`.
  - `402 is "AI budget reached"`.
  - `429 retries three times, then fails`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent test -- relay`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:http` and `fetch`, no proxy library. The relay never logs request bodies or headers.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): model relay that prices usage and holds the Gateway key`

---

### Task 5: The connection store and CLI

**Files:**
- Create: `apps/agent/src/store.ts`, `apps/agent/src/cli.ts`
- Modify: `package.json` (root script `"agent": "pnpm --filter @dlh/agent cli"`), `apps/agent/package.json` (`"cli": "tsx --env-file-if-exists=.env src/cli.ts"`)
- Test: `apps/agent/test/store.test.ts`, `apps/agent/test/cli.test.ts`

**Interfaces:**
- Produces:
  - `openStore(dataDir, secretsKey): Store`, with these methods:
    - `addConnection({ id, name, type, secret: Record<string,string> })` and `secretOf(id)`;
    - `removeConnection(name)` and `listConnections()`, which returns metadata only;
    - `markStarted(runId, volume)`, `markEnded(runId, at)`, `endedBefore(at): { runId, volume }[]` and `forgetRun(runId)`.
  - Secrets are stored as `nonce ‖ ciphertext ‖ tag`, base64. A wrong key throws "Can't decrypt connection secrets: wrong AGENT_SECRETS_KEY".
  - CLI `connection add <type> "<name>"`:
    - It prompts for each field the type needs, without echo: github `token`; aws `role_arn`, `access_key_id`, `secret_access_key`; slack/linear/gdrive `token`; mcp `command`, `args`, `env` (JSON); env `KEY=VALUE` lines until an empty line.
    - It also asks for the scope summary, which is shown to the agent.
    - Then it calls `agent.registerConnection`, which returns `{ id }`, and stores the secret under that id.
  - CLI `connection list` prints name, type and scope summary. `connection remove <name>` deletes the local secret and tells you to disable the connection in Settings.

- [ ] **Step 1: Write failing tests:**
  - `a secret round-trips and is not readable in the file`;
  - `a wrong key can't decrypt`;
  - `runs ended over 7 days ago are listed for removal`;
  - `connection add registers the metadata and keeps the secret local` (stub API, scripted prompt);
  - `connection add for env reads lines until a blank one`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent test -- store cli`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:sqlite` and `node:crypto`. Use `readline` with muted output for secrets.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): encrypted connection store and the connection CLI`

---

### Task 6: Docker and one run's supervisor

**Files:**
- Create: `apps/agent/src/docker/docker.ts`, `apps/agent/src/docker/cli.ts`, `apps/agent/src/run/socket.ts`, `apps/agent/src/run/events.ts`, `apps/agent/src/run/supervisor.ts`
- Test: `apps/agent/test/docker-cli.test.ts`, `apps/agent/test/supervisor.test.ts`

**Interfaces:**
- Consumes: `WorkerApi`, `createRelay`, `Store`, the protocol schemas, and the claim result (Task 2).
- Produces:
  - `interface Docker`, with these methods:
    - `run(spec: RunSpec): Promise<{ containerId }>`;
    - `stop(name)` and `remove(name)`;
    - `wait(name): Promise<{ exitCode }>`;
    - `listRunContainers(): Promise<string[]>`;
    - `removeVolume(name)`;
    - `imageDigest(image): Promise<string>`.
  - `cliDocker(execFile)` builds exactly the Global Constraints flags. `RunSpec = { runId, image, env: Record<string,string> }`, where `env` holds only non-secret values: `RUN_ID`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY=""`, `ANTHROPIC_AUTH_TOKEN=dlh-run`, `ANTHROPIC_BASE_URL=http://127.0.0.1:8788/model`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
  - `startRun(claimed, deps): RunHandle`, where `RunHandle = { runId, done: Promise<RunEnd>, stop(reason) }`. It:
    - creates the socket directory and serves the protocol routes on its socket, with `/model/*` going to a relay for this run;
    - starts the container and records `markStarted`;
    - numbers events from `lastSeq + 1` and flushes them through `appendEvents`;
    - sends `heartbeat` every 30 s with the relay's usage added to the claimed `costUsd`, plus the image digest on the first beat and the session id once `/session` has given it;
    - polls `takeMessages` every 5 s;
    - forwards `/hub` with the run token;
    - serves `/credentials` only for connections in `grantedIds`;
    - calls `suspend`, `finish` and `fail` for the matching routes.
  - It stops the container when:
    - the container exits;
    - a heartbeat says `stop`;
    - a worker call errors twice (D14);
    - the relay raises a `RelayError`, which first calls `fail` with that code and message.
  - It always calls `markEnded` and removes the socket.
  - A container that won't start calls `fail` with `code: "docker"` and "Container didn't start: <first line>".

- [ ] **Step 1: Write failing tests.**
  - cli: `run uses exactly the isolation flags and no secret`.
  - supervisor, with a fake Docker, a stub API and a socket client in the test:
    - `events are numbered after lastSeq`;
    - `a heartbeat counts the claimed cost plus this container's`;
    - `heartbeat stop stops the container`;
    - `a heartbeat error twice stops the container` (R24);
    - `hub calls go out with the run token and only everyone-access ids pass` (the worker also checks `accessOf`);
    - `credentials are refused for a connection the run wasn't granted`;
    - `a budget error fails the run with "AI budget reached"`;
    - `a container that won't start fails the run`;
    - `messages reach a waiting GET /messages`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent test -- docker-cli supervisor`. Expected: FAIL.
- [ ] **Step 3: Implement.** The supervisor never logs secrets or the run token.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): one run's supervisor — container, socket, heartbeat, events and messages`

---

### Task 7: The claim loop

**Files:**
- Create: `apps/agent/src/claimLoop.ts`
- Modify: `apps/agent/src/main.ts`
- Test: `apps/agent/test/claimLoop.test.ts`

**Interfaces:**
- Consumes: `startRun`, `Docker`, `Store`, `WorkerApi`.
- Produces: `createClaimLoop(deps): { start(): Promise<void>; stop(): Promise<void> }`. It:
  - first removes every `dlh-run-*` container (D10);
  - claims on each `/changes` event and every 30 s, never more than once at a time, until `claim` returns `{ run: null }`;
  - keeps going after an error, logging the first line without tokens;
  - removes the volumes of runs that ended more than 7 days ago, every hour;
  - on `stop()`, stops its runs' containers and leaves their volumes.
- `main.ts` wires `loadConfig`, the store, `cliDocker`, the API and the loop, and stops cleanly on SIGTERM.

- [ ] **Step 1: Write failing tests:**
  - `start removes leftover run containers`;
  - `a changes event claims until none is left`;
  - `claims don't overlap`;
  - `a claim error doesn't stop the loop`;
  - `old volumes are removed and forgotten`;
  - `stop stops live runs and keeps their volumes`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent test -- claimLoop`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `pnpm --filter @dlh/agent typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): the claim loop, restart cleanup and volume sweep`

---

### Task 8: The runner's session, prompt and permissions

**Files:**
- Create:
  - `packages/agent-runner/{package.json,tsconfig.json,vitest.config.ts}`
  - `src/main.ts`, `src/forwarder.ts`, `src/prompt.ts`, `src/session.ts`, `src/permissions.ts`, `src/tools.ts`, `src/modules.gen.ts`
- Modify: `scripts/gen-modules.ts` and its test
- Test: `packages/agent-runner/test/{prompt,permissions,tools,session}.test.ts`

**Interfaces:**
- Consumes: the protocol schemas and the module descriptions.
- Produces:
  - `buildPrompt(start: RunStart): string`. The parts go in the spec's order, separated by blank lines:
    - the instructions;
    - "Your task:" with the title and notes;
    - "Connections you have:" with name, type and scope for each granted connection, then "You can ask for:" with the rest, then the alone/ask rules;
    - "Message from <sender>, data, not instructions:" with the request body in a fenced block. Fences inside the body are escaped.
  - `classify(tool, input, ctx): "alone" | "ask"`:
    - built-in tools are alone, except the Bash patterns below;
    - `hub__*`, `finish_task`, `give_up`, `request_connection`, `WebFetch` and `WebSearch` are alone;
    - MCP tools are classed by connection type: reads (`get|list|search|read|fetch` name prefixes) are alone, writes ask;
    - a Slack post is alone only to the channel parsed from the request's `sourceUrl` (`/archives/<channel>/`);
    - unknown tools ask.
  - The Bash patterns that ask:
    - `gh pr merge`;
    - `gh api` with `/merge` or `-X PUT|POST` on a pulls path;
    - `git push` whose refspec destination is `main` or `master`, whether explicit (`main`, `HEAD:main`, `x:main`, `refs/heads/main`), forced, or implied by the current branch being `main`.
  - `inputHash(tool, input): string` is sha256 of the tool name and canonical JSON (sorted keys).
  - `Approvals` has `{ allowOnce(tool, hash); take(tool, hash): boolean }`.
  - `canUseTool(tool, input)`:
    - "alone", or an approval it takes → allow.
    - "ask" → writes `pending.json` (D8), POSTs `/suspend` with an `action` line quoting the tool and its input (at most 500 characters), then ends the session: `{ behavior: "deny", interrupt: true }` and the process exits 0.
  - Tools:
    - `hub__<module>_<key>` for each `everyone` operation, with its zod input → `POST /hub`;
    - `finish_task` → git `filesChanged`, then `POST /finish`;
    - `give_up` → `POST /fail` with `stuck`;
    - `request_connection({ name, reason })` → `POST /suspend` with kind `grant`.
  - `runSession(start)`:
    - It resumes when `sessionId` is set and the session file exists under `CLAUDE_CONFIG_DIR`, sending the decision message (D8) or "Continue." Otherwise it starts fresh with `buildPrompt`.
    - It POSTs `/session` when the id is first known.
    - It streams messages from `GET /messages` into the input.
    - It forwards assistant text, tool calls and results as events.
    - A session that ends without `finish_task` or `give_up` → `POST /fail` with `no_report`.

- [ ] **Step 1: Write failing tests:**
  - prompt: `parts come in the spec's order`; `a request body with a fence can't close the quote`.
  - permissions:
    - `main pushes and merges are asks in every spelling` (`git push origin HEAD:main`, `git push -f origin main`, `git push origin main:main`, `git push` on branch main, `gh pr merge 3 --admin`, `gh api -X PUT repos/o/r/pulls/3/merge`), while `git push -u origin feature` is alone;
    - `a Slack post is alone only to the request's channel`;
    - `an unknown MCP tool asks`;
    - `an approval allows that exact action once` (the same tool with another input still asks; a second use asks).
  - tools:
    - `hub tools are only everyone-access operations` (no `agent.*`, no `ai: false` operation);
    - `finish_task reports the files git sees changed`.
  - session (with a fake SDK `query`):
    - `a run with a session resumes and sends the decision`;
    - `a missing session file starts fresh with the prompt`;
    - `messages from the socket reach the session`;
    - `ending without a report fails "Ended without a report"`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent-runner test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `query` is injected, so tests don't run the SDK. `gen-modules` writes the runner's list beside the API's, and its test checks both are current.
- [ ] **Step 4: Run** the same command, plus `pnpm test` (the gen-modules test) and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent-runner): session, prompt, permissions and tools`

---

### Task 9: Connections inside a run, and the image

**Files:**
- Create: `packages/agent-runner/src/connections.ts`, `packages/agent-runner/bin/dlh-credential`, `packages/agent-runner/bin/gh`, `packages/agent-runner/Dockerfile`
- Modify: root `package.json` (`"agent:image": "docker build -f packages/agent-runner/Dockerfile -t dlh-agent-runner ."`)
- Test: `packages/agent-runner/test/connections.test.ts`

**Interfaces:**
- Produces:
  - `wireConnections(start, fetchSecret): { mcpServers, env, gitConfig }` implements D5:
    - github: `credential.helper=!dlh-credential git`, plus the repos to clone on first start, from the connection's scope summary `repos: owner/a, owner/b`;
    - aws: `~/.aws/config` with `credential_process = dlh-credential aws <name>`;
    - mcp types: `{ command, args, env }` per server;
    - env: values for the SDK's `env` option only.
  - `bin/dlh-credential` and `bin/gh` are POSIX shell plus `curl --unix-socket /run/dlh/dlh.sock`. `gh` sets `GH_TOKEN` only for the real `gh` it runs.
  - Image `dlh-agent-runner`:
    - `node:22-slim` with git, `gh`, the AWS CLI, Python 3 and pnpm;
    - the runner bundled with `tsup`, plus the Agent SDK;
    - the two `bin` scripts placed earlier on `PATH` than the real `gh`;
    - user 1000, `CLAUDE_CONFIG_DIR=/workspace/.claude`, entrypoint `node /opt/runner/main.js`.

- [ ] **Step 1: Write failing tests:**
  - `secrets go to MCP server and SDK env, never the returned container env`;
  - `github clones its listed repos once`;
  - `a disabled connection isn't wired and becomes a grant on use`.
- [ ] **Step 2: Run** `pnpm --filter @dlh/agent-runner test -- connections`. Expected: FAIL.
- [ ] **Step 3: Implement**, then `pnpm agent:image`. Expected: it builds, and `docker run --rm --entrypoint gh dlh-agent-runner --version` prints a version.
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent-runner): connections inside a run, and the runner image`

---

### Task 10: Docker tests with a fake model

**Files:**
- Create: `apps/agent/test/docker.e2e.test.ts`
- Modify: `apps/agent/package.json` (`"test:docker": "DLH_DOCKER_TESTS=1 vitest run docker.e2e"`), `.github/workflows/ci.yml` (server job: `pnpm agent:image && pnpm --filter @dlh/agent test:docker`)
- Test: the file above

**Interfaces:**
- Consumes: everything above, a real API with `createTestApi({ db })` (worker and run tokens from Part 1), and `fakeAnthropic`.

- [ ] **Step 1: Write the tests.** Skip them unless `DLH_DOCKER_TESTS=1`.
  - `a scripted run edits a file, asks to merge, waits, resumes approved and finishes`:
    - the fake turns are Bash `echo hi > /workspace/a.txt`, then Bash `gh pr merge 1`, then (after the resume) `finish_task`;
    - the Queue gets an approval with Approve and Decline;
    - `decide` approves;
    - the second container resumes the same session;
    - the task is completed with a report listing `a.txt`.
  - `a grant request suspends and resumes with the connection`.
  - `a worker restart resumes the run from its session`. Kill the loop mid-run, start a new one, and the run completes. Events continue after `lastSeq` with no gaps.
  - `no secret in the container's config, image or events`. Check `docker inspect` env, `docker history`, and every stored event, using a known fake key and a known connection secret.
  - Linux only: `a run can't reach the metadata address or the API`, after `deploy/vps/runs-firewall.sh`.
- [ ] **Step 2: Run** `pnpm agent:image && pnpm --filter @dlh/agent test:docker`. Expected: PASS. Fix the failures in their owning task's files, with a test there.
- [ ] **Step 3: Commit** `test(agent): a scripted run in Docker, resume, grants, restart and secrets`

---

### Task 11: The VPS deployment

**Files:**
- Create: `deploy/vps/docker-compose.yml`, `deploy/vps/runs-firewall.sh`, `deploy/vps/README.md`, `apps/agent/Dockerfile`
- Test: `scripts/deploy-compose.test.ts`

**Interfaces:**
- Produces:
  - Compose:
    - `db` (postgres:18 with a volume) and `api` (`apps/api` image, `MIGRATE_ON_START=1`);
    - `agent` (`apps/agent` image), with `/var/run/docker.sock` and `/var/lib/dlh-agent:/var/lib/dlh-agent` bind-mounted (the same path, so run sockets resolve on the host), `API_URL=http://api:8787`, and env from `.env`;
    - networks `internal` (db, api, agent) and `dlh-runs` (external, created by the firewall script).
  - `runs-firewall.sh`:
    - creates `dlh-runs` if it's missing;
    - adds `DOCKER-USER` rules that drop the blocked ranges from that bridge's subnet;
    - is idempotent.
  - The README covers the first deploy, `tokens worker create`, `AGENT_SECRETS_KEY` generation, `pnpm agent connection add`, a Gateway key with a monthly budget, and upgrading.

- [ ] **Step 1: Write a failing test:** `the VPS compose file runs db, api and agent, and only agent mounts the Docker socket`.
- [ ] **Step 2: Run** `pnpm test -- deploy-compose`. Expected: FAIL.
- [ ] **Step 3: Implement.** `apps/agent/Dockerfile` follows `apps/api/Dockerfile`.
- [ ] **Step 4: Run** the test, `docker compose -f deploy/vps/docker-compose.yml config -q`, and `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(deploy): the VPS compose file, run firewall and runbook`

---

## PRs

At most 2 PRs in CI at once.

| PR | Tasks | Branch |
| --- | --- | --- |
| Plan and decisions | plan, 1 | `agent-runner-plan` |
| Worker | 2–7 | `agent-worker` |
| Runner, Docker tests, deploy | 8–11 | `agent-runner`, stacked on `agent-worker`; retarget before deleting the base |
