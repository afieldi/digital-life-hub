# AI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type a request about the open item in ⌘K, see how it was understood, and have it answered, offered as options, or done with Undo, through OpenRouter, Claude Code or Codex; modules can add their own AI actions.

**Architecture:** Action descriptions and the keyword interpreter live in `@dlh/core` (shared by app and server). Runners, the gateway, providers and the `ai` router live in `@dlh/server`, with two new tables in `@dlh/db`. OpenRouter is called by the server; the CLIs are run by a new Rust module in the Tauri app, with the server preparing every prompt and checking every answer. The desktop adds an Understood as row and result area to the command bar, toasts with actions, and Settings → AI.

**Tech Stack:** TypeScript, Zod 4, tRPC 11, Drizzle + Postgres, Hono, React 19 + TanStack Query, React Aria (`@dlh/ui`), Tauri 2 (Rust), Vitest, Playwright.

**Spec:** `docs/specs/ai-gateway.md`

**Decisions made while planning**

- AI deps join `CoreDeps` as `ai: AiDeps` (the router lives in `@dlh/server`); `testDeps` and `createTestApi` default to a `FakeProvider`.
- Core's labelled phrasings live in `packages/core/test/ai-phrasings.ts` (the descriptions and interpreter are in `@dlh/core`), not `packages/server/test` as the spec says; module phrasings stay in `modules/<id>/test/ai-phrasings.ts`. Update the spec's path in Task 2.
- AI errors travel as a `TRPCError` whose `cause` is an `AiError`; the error formatter copies `{ code, message }` to `data.ai`.
- CLI output is unwrapped on the server (`unwrapCliOutput`), so the Rust side only returns raw stdout and the parsing is unit-tested in TypeScript.
- The open item reaches the shell through an `OpenItemContext` in `@dlh/client`, set by `useRecordView`; the shell reads the type from `items.get`.

## Global Constraints

- Kinds on the wire: `"ask" | "suggest" | "do"`. Providers: `"openrouter" | "claude-cli" | "codex-cli"`.
- Timeouts: OpenRouter 60 s (server); CLI runs 120 s (app). No automatic retries.
- CLI output cap: 1 MB; past it the process is killed and the run fails as `provider_error`.
- Expiry: pending CLI request 5 minutes; unpicked suggestion 30 minutes.
- Retention: `ai_requests` rows 90 days; `undo` cleared after 30 days.
- Context: `itemContext` trimmed to 12,000 characters, longest parts first.
- Interpreter: "Not sure" below confidence 0.6; every interpreter must pass 90% of labelled phrasings.
- `retitle` Suggest returns exactly 3 options; each `reason` at most 200 characters; titles obey `itemTitle` (1–500 characters).
- `ai.log.list` pages of 50, newest first.
- Never stored: the typed text, prompt, context, Ask answers.
- Copy (verbatim, with `<Provider>` = "OpenRouter", "Claude Code" or "Codex"):
  - `bad_output`: "\<Provider>'s answer wasn't in the expected format, so nothing was changed."
  - `timeout`: "\<Provider> didn't answer within \<n> seconds."
  - `provider_unavailable`: "OpenRouter isn't set up on the server." / "\<Provider> isn't installed on this computer." / "\<Provider> isn't signed in. Run `claude` once in a terminal to sign in." (`codex` for Codex)
  - `provider_error`: "\<Provider> returned an error: \<first line>."
  - `stale`: "This item changed while \<provider> was working, so nothing was changed."
  - `expired`: "This suggestion expired."
  - `not_found`: "This item was deleted."
  - Kind lines: Ask "Answers only, changes nothing"; Suggest "Shows options, changes nothing until you pick"; Do "Changes it now, with Undo after". Capped: "Deletes always show you first".
- No Tauri shell plugin and no general process permission, ever.

## Review Focus

1. **↵ pressed twice, or Use clicked twice.** One request runs; the second apply is refused and nothing is written twice. Test: Task 9 `apply twice is refused`.
2. **Item edited while a CLI run is out.** Nothing is written; `stale` message. Test: Task 8 `do after an edit since prepare ends stale`.
3. **A note with a very long body.** The prompt stays within 12,000 characters of context and still contains the title. Test: Task 5 `trims long bodies first and keeps the title`.
4. **⌘K on Home (no item open).** Only `answer` is offered; prepare works with no `itemId`. Test: Task 9 `answer with no item`.
5. **CLI prints a wrapped envelope, non-JSON, or megabytes of text.** Envelope unwrapped; non-JSON gives `bad_output`; oversize killed. Tests: Task 6 `unwrapCliOutput`, Task 11 `output over 1 MB kills the process`.

## File structure

```
packages/core/src/ai/            NEW
  kinds.ts            AiKind, AiEffect, AiProviderId, capFor, kindAllowed
  actions.ts          describeAiAction, AiActionDescription, coreAiActions (answer, retitle, delete)
  interpreter.ts      RequestInterpreter, Interpretation, applicableActions
  keywords.ts         keywordInterpreter
  api.ts              Zod: aiPrepareInput, aiCompleteInput, aiResult, aiSettings, aiLogEntry, aiErrorData
  suite.ts            runInterpreterSuite, Phrasing (exported as @dlh/core/testing)
packages/core/test/ai-*.test.ts, ai-phrasings.ts
packages/db/src/schema.ts         + aiRequests, aiSettings; drizzle/0004_ai.sql
packages/server/src/ai/          NEW
  runners.ts          defineAiRunner, AiRunner, collectAiRunners
  scoped.ts           scopedWriter
  context.ts          itemContext
  errors.ts           AiError, aiErrorMessage
  providers/openrouter.ts, providers/cli.ts (unwrapCliOutput), providers/index.ts (AiProvider)
  core-runners.ts     runners for answer, retitle, delete
  gateway.ts          prepare, complete, apply, discard, undo, cancel
  settings.ts         getSettings, setSettings, providerStatus
  log.ts              listLog
  router.ts           aiRouter
packages/server/src/{modules,trpc,routers,testing,index}.ts, items/purge.ts   modified
packages/client/src/index.tsx     + OpenItemContext, useOpenItem
packages/ui/src/patterns/CommandBar.tsx, primitives/Toast.tsx, internal/toast.ts   modified
apps/api/src/{config,main,testing}.ts, cli/ai-smoke.ts                 modified/new
apps/desktop/src/ai/             NEW: cli.ts (Tauri bridge + fake), useAiRequest.ts, UnderstoodAs.tsx, AiResult.tsx
apps/desktop/src/shell/Shell.tsx, routes/settings/Ai.tsx                modified/new
apps/desktop/src-tauri/src/cli.rs NEW; lib.rs, Cargo.toml modified
apps/desktop/e2e/ai.spec.ts       NEW
scripts/ai-eval-interpreter.ts    NEW
```

---

### Task 1: Kinds, effects and action descriptions

**Files:**
- Create: `packages/core/src/ai/kinds.ts`, `packages/core/src/ai/actions.ts`, `packages/core/src/ai/api.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/module.ts` (`ModuleManifest.aiActions?: AiActionDescription[]`), `packages/core/src/registry.ts` (collect `aiActions` into `ModuleRegistry.aiActions`)
- Test: `packages/core/test/ai-actions.test.ts`

**Interfaces:**
- Produces:
  - `type AiKind = "ask" | "suggest" | "do"`; `type AiProviderId = "openrouter" | "claude-cli" | "codex-cli"`
  - `type AiEffect = "updateItem" | "createItems" | "addLinks" | "deleteItems" | "setArchived" | "writeOtherItems"`
  - `capFor(effects: AiEffect[]): AiKind` — `[]`→ask; only `updateItem`/`createItems`/`addLinks` → do; any of `deleteItems`/`setArchived`/`writeOtherItems` → suggest
  - `kindAllowed(d: AiActionDescription, kind: AiKind): AiKind` — closest allowed kind not above the cap (order ask < suggest < do; prefer suggest when downgrading from do)
  - `describeAiAction(d: AiActionDescription): AiActionDescription` — throws if `id` does not match `/^([a-z][a-z0-9]*\.)?[a-z][a-zA-Z0-9]*$/`, `kinds` is empty, or `description` is empty
  - `type AiActionDescription = { id; label; description; appliesTo: string[] | "*" | "none" | ("*" | "none")[]; kinds: AiKind[]; effects: AiEffect[]; words?: string[] }`
  - `coreAiActions: { answer, retitle, delete }` (values per spec table; `answer.appliesTo = ["*", "none"]`)
  - Zod in `api.ts`: `aiKind`, `aiProviderId`, `aiPrepareInput` `{ text: string max 2000, itemId?: uuid, actionId, kind, interpretedBy?: string, provider?: aiProviderId }`, `aiCompleteInput` `{ requestId: uuid, raw: string max 1_048_576 }`, `aiResult` (union: `{ requestId, status: "answered", answer, used: string[] }` | `{ requestId, status: "suggested", options: { label: string; reason?: string }[] }` | `{ requestId, status: "applied", summary }` | `{ requestId, status: "run", run: { provider, system, prompt, schema: unknown } }`), `aiSettings` `{ defaultProvider, openrouterModel, interpreter: "keywords" }`, `aiLogEntry` `{ id, createdAt, actionId, kind, interpretedBy, provider, model, status, errorCode, durationMs, inputTokens, outputTokens, costUsd, canUndo }`, `aiErrorData` `{ code: "bad_output"|"timeout"|"provider_unavailable"|"provider_error"|"stale"|"expired"|"not_found", message }`

- [ ] **Step 1: Write failing tests** — `capFor([])` is `"ask"`; `capFor(["updateItem"])` is `"do"`; `capFor(["createItems","addLinks"])` is `"do"`; `capFor(["updateItem","deleteItems"])` is `"suggest"`; `kindAllowed(coreAiActions.delete, "do")` is `"suggest"`; `kindAllowed(coreAiActions.retitle, "ask")` is `"suggest"`; `describeAiAction({ ...valid, id: "Bad Id" })` throws; `collectModules` exposes manifest `aiActions` on the registry.
- [ ] **Step 2: Run** `pnpm --filter @dlh/core test` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** `pnpm --filter @dlh/core test && pnpm --filter @dlh/core typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): AI kinds, effects, caps and action descriptions`

---

### Task 2: Interpreter contract, keyword interpreter and phrasing suite

**Files:**
- Create: `packages/core/src/ai/interpreter.ts`, `packages/core/src/ai/keywords.ts`, `packages/core/src/ai/suite.ts`, `packages/core/test/ai-phrasings.ts`
- Modify: `packages/core/package.json` (add `"./testing": "./src/ai/suite.ts"`), `docs/specs/ai-gateway.md` (phrasings path → `packages/core/test/ai-phrasings.ts`)
- Test: `packages/core/test/ai-keywords.test.ts`

**Interfaces:**
- Consumes: Task 1 descriptions, `capFor`, `kindAllowed`
- Produces:
  - `interface RequestInterpreter { id: string; interpret(input: { text: string; itemType: string | null; actions: AiActionDescription[]; signal: AbortSignal }): Promise<Interpretation> }`
  - `type Interpretation = { actionId: string; kind: AiKind; confidence: number; alternatives: { actionId: string; kind: AiKind }[]; source: string }`
  - `applicableActions(all: AiActionDescription[], itemType: string | null): AiActionDescription[]` — type-specific first, then `"*"`, or only `"none"` actions when `itemType` is null
  - `NOT_SURE_BELOW = 0.6`
  - `keywordInterpreter: RequestInterpreter` (id `"keywords"`)
  - `type Phrasing = { text: string; itemType: string | null; actionId: string; kind: AiKind }`; `runInterpreterSuite(i: RequestInterpreter, actions: AiActionDescription[], phrasings: Phrasing[]): Promise<{ accuracy: number; misses: { phrasing: Phrasing; got: Interpretation }[] }>`

The keyword algorithm is the spec's four steps (Interpreting requests). Scores: single word 1, phrase of n words n+1, type-specific bonus +1; one-letter typo match for words of 5+ letters scores half. Confidence = winner / (winner + runner-up), 1 when there is no runner-up, 0.3 when nothing matched (fallback `answer`).

- [ ] **Step 1: Write the phrasings file** with at least 30 Core phrasings including every row of the spec's example table (e.g. `{ text: "give this a better title", itemType: "test", actionId: "retitle", kind: "do" }`, `"what's a better title?"` → retitle/suggest, `"don't rename it, just fix typos"` → retitle/suggest, `"delete this"` → delete/suggest, `"hmm"` → answer/ask, `"summarise this"` with `itemType: null` → answer/ask).
- [ ] **Step 2: Write failing tests**: `runInterpreterSuite(keywordInterpreter, …)` accuracy ≥ 0.9; `"don't rename it"` has confidence < 0.6; `"delete this"` never returns `"do"`; with `itemType: null` the result is always `answer`; a type-specific action with the same words beats the `"*"` one; an aborted `signal` rejects.
- [ ] **Step 3: Run** `pnpm --filter @dlh/core test` — Expected: FAIL.
- [ ] **Step 4: Implement** interpreter, keyword interpreter and suite.
- [ ] **Step 5: Run** `pnpm --filter @dlh/core test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): request interpreter contract and keyword interpreter`

---

### Task 3: Tables, migration and purge

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/server/src/items/purge.ts`
- Create: `packages/db/drizzle/0004_ai.sql` (via `pnpm --filter @dlh/db generate`)
- Test: `packages/server/test/purge.db.test.ts` (extend if present, else create)

**Interfaces:**
- Produces: `aiRequests` (columns exactly as the spec's `ai_requests` table; `status` text; index `ai_requests_created_idx` on `created_at desc`; `item_id` references `items.id` `on delete set null`), `aiSettings` (single row: `id integer primary key default 1 check (id = 1)`, `default_provider`, `openrouter_model` nullable, `interpreter` default `'keywords'`, `updated_at`). `purgeExpired` returns `{ items, views, aiRequests, aiUndoCleared, aiExpired }`.

- [ ] **Step 1: Write failing tests** — purge deletes `ai_requests` older than 90 days and keeps newer; nulls `undo` older than 30 days; marks `pending` older than 5 minutes and `suggested` older than 30 minutes as `expired` and nulls their `output`; purging an item sets `ai_requests.item_id` null.
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test:db -- purge` — Expected: FAIL.
- [ ] **Step 3: Add tables, generate the migration, extend `purgeExpired`.**
- [ ] **Step 4: Run** `pnpm --filter @dlh/db migrate && pnpm --filter @dlh/server test:db -- purge` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): ai_requests and ai_settings tables, purge rules`

---

### Task 4: Runners, module registration and the scoped writer

**Files:**
- Create: `packages/server/src/ai/runners.ts`, `packages/server/src/ai/scoped.ts`
- Modify: `packages/server/src/modules.ts` (`ServerModule.aiRunners?: AiRunner[]`; `collectServerModules(mods, reserved, aiActions)` also returns `aiRunners: Map<string, AiRunner>`; add `"ai"` to `CORE_ROUTER_IDS`), `packages/server/src/index.ts`, `apps/api/src/main.ts`, `apps/api/src/testing.ts` (pass descriptions)
- Test: `packages/server/test/ai-runners.test.ts`, `packages/server/test/ai-scoped.db.test.ts`

**Interfaces:**
- Consumes: Task 1 `AiActionDescription`, `AiEffect`; `ItemWriter`
- Produces:
  - `type AiRunner<D extends AiActionDescription = AiActionDescription> = { action: D; context(deps: CoreDeps, itemId: string | null): Promise<AiContext>; system: string; output: Partial<Record<AiKind, z.ZodType>>; apply?(w: ScopedWriter, out: unknown, ctx: AiContext): Promise<unknown>; undo?(w: ScopedWriter, record: unknown): Promise<void>; summary?(out: unknown, ctx: AiContext): string }`
  - `defineAiRunner(action, rest): AiRunner`
  - `collectAiRunners(descriptions: AiActionDescription[], runners: AiRunner[], moduleOf: Map<string, string>, ownedTypes: Map<string, string>): Map<string, AiRunner>` — throws `ServerModuleError` for: id without its module prefix (Core runners have no prefix), description without runner, runner without description, duplicate id, `appliesTo` naming a type the module does not own
  - `type ScopedWriter = Pick<ItemWriter, "tx"> & Partial<Omit<ItemWriter, "tx">>`; `scopedWriter(w: ItemWriter, scope: { effects: AiEffect[]; itemId: string | null }): ScopedWriter` — exposes only methods the effects allow; `updateItem` only on `scope.itemId`; `addLink` only with `fromId === scope.itemId`; any other call throws `TRPCError({ code: "FORBIDDEN", message: "AI action wrote outside its effects" })`

- [ ] **Step 1: Write failing tests** — each `collectAiRunners` refusal above with its message; a scoped writer for `["updateItem"]` has no `setDeleted`; `updateItem` on another id throws FORBIDDEN and, inside `writeItems`, rolls back an earlier write in the same transaction.
- [ ] **Step 2: Run** `pnpm --filter @dlh/server test -- ai-runners && pnpm --filter @dlh/server test:db -- ai-scoped` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both — Expected: PASS. Also `pnpm --filter @dlh/api typecheck`.
- [ ] **Step 5: Commit** `feat(server): AI runner registration and effect-scoped writer`

---

### Task 5: Item context

**Files:**
- Create: `packages/server/src/ai/context.ts`
- Modify: `packages/server/src/items/read.ts` (add `getItemText(db, id): Promise<string | null>` selecting `search_text`)
- Test: `packages/server/test/ai-context.db.test.ts`

**Interfaces:**
- Produces: `type AiContext = { item: Item | null; text: string; version: string | null }`; `itemContext(deps: CoreDeps, itemId: string | null): Promise<AiContext>` — `text` is a plain-text block: title, type, body (`search_text`), then outgoing links and backlinks as `- <kind>: <title>` lines; `MAX_CONTEXT_CHARS = 12_000`; when over, trim the body first, then link lines, never the title; `version` = `item.updatedAt`. Null `itemId` gives `{ item: null, text: "", version: null }`.

- [ ] **Step 1: Write failing tests** — includes title, body and both link directions; `trims long bodies first and keeps the title` (body of 20,000 chars → `text.length <= 12_000`, title present); deleted item → `NOT_FOUND`.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/server test:db -- ai-context`.
- [ ] **Step 5: Commit** `feat(server): AI item context`

---

### Task 6: Providers, CLI output unwrapping and fakes

**Files:**
- Create: `packages/server/src/ai/providers/index.ts`, `providers/openrouter.ts`, `providers/cli.ts`, `packages/server/src/ai/errors.ts`
- Modify: `packages/server/src/testing.ts` (`FakeProvider`)
- Test: `packages/server/test/ai-openrouter.test.ts`, `packages/server/test/ai-cli.test.ts`

**Interfaces:**
- Produces:
  - `interface AiProvider { id: AiProviderId; complete(req: { system: string; prompt: string; schema: object; model: string; signal: AbortSignal }): Promise<{ raw: string; usage?: { input: number; output: number; costUsd?: number } }> }`
  - `createOpenRouter(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): AiProvider` — POST `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer`, `model`, `messages: [system, user]`, `response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } }`, `usage: { include: true }`; returns `choices[0].message.content` and usage (`prompt_tokens`, `completion_tokens`, `cost`); default timeout 60_000
  - `class AiError extends Error { code: AiErrorData["code"]; constructor(code, message) }`; `aiErrorMessage(code, provider: AiProviderId, extra?: { seconds?: number; firstLine?: string; reason?: "not_installed" | "signed_out" | "no_key" }): string` (copy from Global Constraints); `PROVIDER_NAMES: Record<AiProviderId, string>`
  - `unwrapCliOutput(provider: "claude-cli" | "codex-cli", stdout: string): string` — Claude: parse the JSON envelope; return `JSON.stringify(structured_output)` if present, else `result`; envelope `is_error: true` → `AiError("provider_error", …)`. Codex: the app returns the last-message file's contents; return it trimmed.
  - `class FakeProvider implements AiProvider` — `queue(...outputs: (string | { error: AiErrorData["code"] } | { delayMs: number; raw: string })[])`, records `calls`
- [ ] **Step 1: Write failing tests** — OpenRouter: request body shape (model, schema, `usage.include`), maps usage, HTTP 401 → `provider_unavailable`, 5xx → `provider_error` with first line, abort after `timeoutMs` → `timeout` (use `timeoutMs: 10`); `unwrapCliOutput`: Claude envelope with `structured_output`, envelope with only `result`, `is_error` envelope, non-JSON stdout → `bad_output`; `aiErrorMessage` produces each copy string exactly.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/server test -- ai-openrouter ai-cli`.
- [ ] **Step 5: Commit** `feat(server): OpenRouter provider, CLI output unwrapping, AI errors`

---

### Task 7: Core runners

**Files:**
- Create: `packages/server/src/ai/core-runners.ts`
- Test: `packages/server/test/ai-core-runners.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5
- Produces: `coreAiRunners: AiRunner[]` for `answer` (output `ask`: `{ answer: string max 4000, used: uuid[] max 10 }`), `retitle` (output `suggest`: `{ options: { title: itemTitle; reason: string max 200 }[] length 3 }`, `do`: `{ title: itemTitle }`; apply = `updateItem` returning `{ id, title: <old> }`; undo restores; summary `Renamed to “<title>”`), `delete` (output `suggest`: `{ options: [{ summary: string max 200 }] length 1 }`; apply = `setDeleted(true)`; undo = `setDeleted(false)`; summary `Deleted “<title>”`). Each `system` prompt tells the model it works in a personal tasks-and-notes app, returns only JSON matching the schema, and treats the person's request as the instruction.

- [ ] **Step 1: Write failing tests** — each schema accepts a valid sample and rejects: 2 options, a 201-char reason, an empty title, an unknown field-only object; `summary` strings as above.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS).**
- [ ] **Step 5: Commit** `feat(server): core AI runners for answer, retitle and delete`

---

### Task 8: The gateway

**Files:**
- Create: `packages/server/src/ai/gateway.ts`
- Modify: `packages/server/src/trpc.ts` (`CoreDeps.ai: AiDeps`; error formatter copies `AiError` cause to `data.ai`), `packages/server/src/testing.ts` (`testDeps` gets `ai` with a `FakeProvider` and core runners)
- Test: `packages/server/test/ai-gateway.db.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7
- Produces:
  - `type AiDeps = { runners: Map<string, AiRunner>; descriptions: AiActionDescription[]; providers: Partial<Record<"openrouter", AiProvider>>; defaultModel: string | null }`
  - `prepare(deps, input: AiPrepareInput): Promise<AiResult>` — validates action, item type (`NOT_FOUND` for a missing/deleted item; `BAD_REQUEST` if the action does not apply), downgrades kind via `kindAllowed`, resolves provider (`input.provider ?? settings.defaultProvider`), inserts the row, builds context and prompt; OpenRouter → calls and finishes; CLI → returns `{ status: "run", run }` with `schema = z.toJSONSchema(runner.output[kind])`
  - `complete(deps, { requestId, raw }): Promise<AiResult>` — only for `pending` CLI rows not past 5 minutes (`expired` otherwise); `unwrapCliOutput` then the shared finish
  - shared finish: `JSON.parse` + schema check → `bad_output`; ask → `answered`; suggest → store `output`, return options mapped to `{ label, reason }` (retitle: `title`→`label`; delete: `summary`→`label`), `suggested`; do → `writeItems` + `scopedWriter`, `updateItem` called with `expectedUpdatedAt = row.item_version` (`CONFLICT` → `stale`), store `undo`, `applied`
  - `apply(deps, { requestId, option })`, `discard(deps, { requestId })`, `undo(deps, { requestId })`, `cancel(deps, { requestId })` — single use (`CONFLICT` on repeat); `apply` checks 30-minute expiry; `undo` refuses if the item's `updated_at` moved since apply (`stale`)
  - Every path sets `finished_at`, `duration_ms`, tokens, cost, `error_code`/`error_message`. The prompt is `<instruction>\n<text>\n</instruction>\n<item>\n<context>\n</item>`; neither is written to the row.
- [ ] **Step 1: Write failing tests** — ask returns the answer and writes no item; suggest stores 3 options, `apply` renames and publishes a change (`expectTracked`); do renames at once, `undo` restores, second `undo` → CONFLICT; `do after an edit since prepare ends stale`; `kind: "do"` for `delete` runs as suggest; bad JSON → `failed`/`bad_output` and no write; CLI path: prepare returns `run`, `complete` with a Claude envelope finishes, `complete` after 5 minutes → `expired`, unknown id → `NOT_FOUND`, finished id → CONFLICT; `the log never holds the typed text` (scan every text/jsonb column of the row for the input text); a runner with `effects: ["updateItem"]` that calls `setDeleted` rolls back and ends `failed`.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/server test:db -- ai-gateway`.
- [ ] **Step 5: Commit** `feat(server): AI gateway prepare, complete, apply and undo`

---

### Task 9: Settings, log, router and API wiring

**Files:**
- Create: `packages/server/src/ai/settings.ts`, `packages/server/src/ai/log.ts`, `packages/server/src/ai/router.ts`
- Modify: `packages/server/src/routers.ts` (mount `ai`), `apps/api/src/config.ts` (`openrouter: { apiKey: string | null; defaultModel: string | null }` from `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`), `apps/api/.env.example`, `apps/api/src/main.ts` (build `ai` deps: core + module runners, OpenRouter only when the key is set), `apps/api/src/testing.ts` (`createTestApi({ aiProvider?: FakeProvider })`)
- Test: `apps/api/test/ai.db.test.ts`, `apps/api/test/config.test.ts`

**Interfaces:**
- Produces: `aiRouter` with `prepare`, `complete`, `cancel`, `apply`, `discard`, `undo` (mutations), `settings.get` (query → `aiSettings & { providers: { id: AiProviderId; available: boolean; reason?: "no_key" }[] }`; CLIs always `available: true` server-side), `settings.set` (mutation, partial), `log.list` (query `{ cursor? }` → `{ entries: AiLogEntry[]; nextCursor: string | null }`, 50 per page, `canUndo` true for `applied` rows with non-null `undo`).
- [ ] **Step 1: Write failing tests** through `createTestApi` + `signIn`: `answer with no item`; rename Do then Undo; `apply twice is refused`; settings round-trip and unknown provider rejected; `settings.get` reports OpenRouter `available: false, reason: "no_key"` when unset; `log.list` paging and `canUndo`; error responses carry `data.ai.code`; unauthenticated calls → UNAUTHORIZED. Config: missing OpenRouter vars do not throw.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/api test:db -- ai && pnpm --filter @dlh/api test -- config`.
- [ ] **Step 5: Commit** `feat(api): ai router, settings, log and OpenRouter config`

---

### Task 10: Eval and smoke commands

**Files:**
- Create: `scripts/ai-eval-interpreter.ts`, `scripts/ai-eval-interpreter.test.ts`, `apps/api/src/cli/ai-smoke.ts`
- Modify: root `package.json` (`"ai:eval-interpreter": "tsx scripts/ai-eval-interpreter.ts"`, `"ai:smoke": "pnpm --filter @dlh/api ai:smoke"`), `apps/api/package.json` (`"ai:smoke": "tsx --env-file-if-exists=.env src/cli/ai-smoke.ts"`)

**Interfaces:**
- `ai-eval-interpreter.ts --interpreter=keywords` loads Core and every `modules/*/test/ai-phrasings.ts`, runs `runInterpreterSuite`, prints accuracy (one decimal %), a confusion list (`expected retitle/do, got answer/ask: "<text>"`) and median ms per guess; exits 1 below 90%.
- `ai-smoke.ts` creates a seeded `sample` item, runs `answer` ("summarise this item") and `retitle` (do, then undo) through OpenRouter if configured and through each CLI found on `PATH` (spawning it with the same arguments as Task 11), printing each result and log row; skips unavailable providers with a line saying why.

- [ ] **Step 1: Write the failing test** — running the eval script on the Core phrasings exits 0 and prints `Accuracy:`.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm test:scripts -- ai-eval`.
- [ ] **Step 5: Commit** `feat: ai:eval-interpreter and ai:smoke commands`

---

### Task 11: Rust CLI runner

**Files:**
- Create: `apps/desktop/src-tauri/src/cli.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (manage `CliState`, register `ai_cli_status`, `ai_cli_run`, `ai_cli_cancel`), `apps/desktop/src-tauri/Cargo.toml` (`tempfile = "3"`, `which = "7"`), `apps/desktop/test/capabilities.test.ts`

**Interfaces:**
- Produces Tauri commands:
  - `ai_cli_status(provider: String, path_override: Option<String>) -> { installed: bool, signed_in: bool, version: Option<String> }` — runs `<bin> --version`; signed-in check: Claude `claude auth status` exit 0, Codex `codex login status` exit 0
  - `ai_cli_run(run_id: String, provider: String, path_override: Option<String>, system: String, prompt: String, schema: String) -> { stdout: String, exit_code: i32 }` — errors as `{ code: "not_installed" | "timeout" | "too_large" | "spawn_failed" | "cancelled", message }`
  - `ai_cli_cancel(run_id: String)`
- Arguments (fixed, never through a shell; prompt on stdin):
  - Claude: `-p --output-format json --json-schema <schema> --system-prompt <system> --tools "" --strict-mcp-config --no-session-persistence --disable-slash-commands`
  - Codex: `exec --sandbox read-only --skip-git-repo-check --output-schema <tmp>/schema.json --output-last-message <tmp>/out.txt -` with `system` prepended to the prompt; `stdout` returned = contents of `out.txt`
- Each run: fresh `tempfile::TempDir` as the working directory, removed on drop; 120 s timeout and 1 MB stdout cap kill the child.
- `resolve_binary(provider, override) -> Result<PathBuf>`: only `claude`/`codex`; an override must be absolute and its file name equal the expected binary.

- [ ] **Step 1: Verify flags** — run `claude --help` and (where installed) `codex exec --help`; confirm every flag above exists. Codex is not installed on the planning machine: if a flag differs, adjust the Codex argument list here and in `ai-smoke.ts`, and note it in the commit.
- [ ] **Step 2: Write failing Rust tests** (`#[cfg(test)]`, using a stand-in shell script written to a temp dir as the binary): `resolve_binary` refuses `bash`, a relative override and `/tmp/claude-evil`; argument list for Claude equals the fixed list and does not contain the prompt; prompt arrives on stdin; `timeout kills the process` (script sleeps; timeout set to 200 ms in test); `output over 1 MB kills the process`; the temp dir no longer exists after the run.
- [ ] **Step 3: Extend the capabilities test** — no permission starts with `shell:` or `process:`.
- [ ] **Step 4: Run** `cd apps/desktop/src-tauri && cargo test` and `pnpm --filter @dlh/desktop test -- capabilities` — Expected: FAIL, then implement, then PASS.
- [ ] **Step 5: Commit** `feat(desktop): Claude Code and Codex runner`

---

### Task 12: Command bar slots and toast actions

**Files:**
- Modify: `packages/ui/src/patterns/CommandBar.tsx` (props `interpretation?: ReactNode` rendered between input and results; `result?: ReactNode` replacing the result rows when set; `onKeyDown?: (e) => boolean` called first, returning true to stop default handling), `packages/ui/src/internal/toast.ts` and `packages/ui/src/primitives/Toast.tsx` (`ToastContentValue.actions?: { label: string; onAction: () => void }[]`; `toast(message, { tone?, timeout?, actions? })` returns the toast key; `closeToast(key)`), `packages/ui/src/gallery/stories/patterns.stories.tsx` (Understood as + result examples)
- Test: `packages/ui/test/patterns.test.tsx`, `packages/ui/test/primitives-c.test.tsx`

- [ ] **Step 1: Write failing tests** — `interpretation` renders above results; `result` hides the groups; `onKeyDown` returning true prevents ↑↓/↵ handling; a toast with `actions` renders each as a button that calls `onAction` and closes the toast; `closeToast` removes it.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/ui test`.
- [ ] **Step 5: Commit** `feat(ui): command bar interpretation and result slots, toast actions`

---

### Task 13: Ask AI in the command bar

**Files:**
- Modify: `packages/client/src/index.tsx` (`OpenItemContext`, `OpenItemProvider`, `useOpenItem(): string | null`; `useRecordView(id)` also sets the open item while mounted)
- Create: `apps/desktop/src/ai/cli.ts` (`runCli`, `cliStatus`, `cancelCli` via `invoke`; `setCliRunnerForTests(fake)`), `apps/desktop/src/ai/useAiRequest.ts`, `apps/desktop/src/ai/UnderstoodAs.tsx`, `apps/desktop/src/ai/AiResult.tsx`
- Modify: `apps/desktop/src/shell/Shell.tsx`, `apps/desktop/src/App.tsx` (wrap in `OpenItemProvider`)
- Test: `apps/desktop/test/ai.db.test.tsx`, `apps/desktop/test/understoodAs.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 9, 11, 12
- Produces:
  - `useAiRequest(): { state: AiUiState; run(req: { text; itemId; actionId; kind; interpretedBy }): void; apply(option: number): void; discard(): void; undo(requestId: string): void; cancel(): void }` with `AiUiState = { phase: "idle" | "working" | "answered" | "suggested" | "applied" | "error"; provider; result?; error?: AiErrorData }`. For `status: "run"` it calls `runCli` with the device's path override (local storage key `dlh.ai.cliPath.<provider>`), maps Rust error codes to `AiErrorData`, and posts `ai.complete`.
  - In the Shell: when an item is open, `keywordInterpreter` runs on the query (cancelled per keystroke); `UnderstoodAs` renders the AI tile, label, Ask · Suggest · Do toggle (only allowed kinds), kind line, provider name, and "Not sure" below 0.6. Keys: Tab cycles kinds, ↑↓ alternatives, ↵ runs. Ask/Suggest/errors render in `result`; Do closes the bar, shows `toast("<Provider> is <working>…", { actions: [Cancel] })`, then `toast(summary, { tone: "success", actions: [Undo, Show options] })`.
- [ ] **Step 1: Write failing tests** with the API harness and a fake CLI runner: typing "give this a better title" on a sample item shows "Rename" and Do; Tab switches to Suggest; ↵ with the fake provider renames and shows the Undo toast; Undo restores; Suggest shows 3 options and Use applies the second; "delete this" shows Suggest with "Deletes always show you first"; Show options after a Do runs the same request as Suggest; an Ask answer shows the items in `used` as links; a `bad_output` shows the exact message and "Use OpenRouter"; on Home only `answer` is offered.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/desktop test:db -- ai && pnpm --filter @dlh/desktop test -- understoodAs`.
- [ ] **Step 5: Commit** `feat(desktop): Ask AI in the command bar`

---

### Task 14: Settings → AI

**Files:**
- Create: `apps/desktop/src/routes/settings/Ai.tsx`
- Modify: `apps/desktop/src/routes/Settings.tsx`
- Test: `apps/desktop/test/aiSettings.db.test.tsx`

- [ ] **Step 1: Write failing tests** — default provider select saves through `ai.settings.set`; OpenRouter shows "Not set up on the server" without a key; CLI rows show Ready / Not installed / Signed out from a faked `cliStatus` and Check again re-runs it; the path override saves to local storage; Recent requests lists log rows (action, kind, provider, duration, result) and Undo calls `ai.undo` and disappears afterwards.
- [ ] **Step 2–4: Run (FAIL), implement, run (PASS)** with `pnpm --filter @dlh/desktop test:db -- aiSettings`.
- [ ] **Step 5: Commit** `feat(desktop): AI settings and recent requests`

---

### Task 15: End to end and docs

**Files:**
- Create: `apps/desktop/e2e/ai.spec.ts`
- Modify: `apps/desktop/playwright.config.ts` (API env `AI_FAKE_PROVIDER=1`; `apps/api/src/main.ts` uses a scripted `FakeProvider` as `openrouter` when set and `NODE_ENV=development`), `docs/specs/core-and-shell.md` (milestone 4 status line), `README.md` (env vars and the two new commands)

- [ ] **Step 1: Write the e2e tests** — rename with Do and Undo; Suggest and Use; "delete this" shown first and cancelled; a scripted bad answer shows the `bad_output` message.
- [ ] **Step 2: Run** `pnpm --filter @dlh/desktop exec playwright test ai` — Expected: PASS.
- [ ] **Step 3: Run everything** — `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db` and `cargo test` in `src-tauri`. Expected: all PASS.
- [ ] **Step 4: Manual Done check** — with `OPENROUTER_API_KEY` set and Claude Code and Codex signed in, run `pnpm ai:smoke`; every provider prints an answer, a rename and an undo. Only then set the milestone 4 status line to "done (<date>)" in `docs/specs/core-and-shell.md`.
- [ ] **Step 5: Commit** `test(e2e): AI gateway flows; docs`
