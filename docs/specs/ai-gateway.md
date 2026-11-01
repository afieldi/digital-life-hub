# AI Gateway — Deep-dive Spec

Oct 31, 2026 · Arek

## Scope

Milestone 4 of [Core + Shell](core-and-shell.md), the last one. When it is done, you can type a request about the item on screen in ⌘K ("give this a better title", "what's left on this?"), see how it was understood, and have it answered, offered as options or done, through OpenRouter, Claude Code or Codex. Modules add their own AI actions without changing Core.

**In scope**

- AI actions: a shared description (what it does, when to use it, what it may change) and a server-side runner, registered by Core and by modules
- Three kinds of action: Ask (answer only), Suggest (pick from options) and Do (applied at once, with Undo)
- Caps worked out from an action's effects, enforced by the server and by a writer limited to those effects
- A swappable request interpreter, with a keyword implementation and an eval command
- The gateway: context, prompts, providers, output checks, apply and undo, request log
- Providers: OpenRouter on the server; Claude Code and Codex run by the desktop app
- Core actions `answer`, `retitle` and `delete`
- ⌘K additions: the Understood as row, Suggest and Ask results, Do toasts with Undo
- Settings → AI, and a recent-requests log

**Out of scope**

- A model-based interpreter (the contract is built for it; see Interpreting requests)
- The Ask AI side panel and full conversations from the designs
- Module actions (Tasks adds the first ones in its own spec)
- Background jobs that call AI with the app closed
- Streaming answers and automatic retries

**Done when**

- "Summarise this item" (Ask) and "give this a better title" (Do, then Undo) work through all three providers
- A malformed answer is rejected with a clear message and nothing is written
- "Delete this" is shown first and never applied directly
- All of the above shows in the request log

## Kinds of action

AI changes only what you asked it to change, and every change it makes can be undone.

| Kind | You say | What happens |
| --- | --- | --- |
| **Ask** | "what's left on this?", "summarise this" | An answer is shown. Nothing is written |
| **Suggest** | "suggest a few titles" | Options are shown (three for `retitle`); picking one applies it; "None of these" discards |
| **Do** | "give this a better title" | Applied at once; a toast shows what changed, with Undo and Show options |

This replaces "nothing is written until you confirm" in the Core spec and settles the open question in [design.md](../design.md) about how much AI acts on its own.

## Actions

An action has two halves, matching the existing module split: a **description** the app and server both import, and a **runner** the server alone holds.

```ts
// a module's shared file, e.g. modules/tasks/src/ai.ts (Core's live in @dlh/core)
export const retitle = describeAiAction({
  id: "retitle",                         // module actions are prefixed: "tasks.breakDown"
  label: "Rename",
  description:
    "Rewrites the item's title to be clearer and more specific. Use when the person wants " +
    "a new or better name. Not for editing the item's content.",
  appliesTo: "*",                        // item types, "*" for any, or "none" for no item
  kinds: ["suggest", "do"],
  effects: ["updateItem"],
  words: ["title", "rename", "name it"], // optional hints for the keyword interpreter
});

// server only, e.g. modules/tasks/src/server.ts (Core's live in @dlh/server)
defineAiRunner(retitle, {
  context: (deps, itemId) => itemContext(deps, itemId),
  system: "You rename items in a personal task and notes app…",
  output: {
    suggest: z.object({ options: z.array(z.object({ title: itemTitle, reason: z.string().max(200) })).length(3) }),
    do: z.object({ title: itemTitle }),
  },
  apply: (w, out, ctx) => w.updateItem({ id: ctx.item.id, title: out.title }),   // returns the undo record
  undo: (w, record) => w.updateItem({ id: record.id, title: record.title }),
});
```

- `description` is required and written for a reader, human or model: what the action does, when to use it, when not to. The command bar and Settings show it as help text.
- `words` is optional and read only by the keyword interpreter.
- A runner's `output` has one schema per kind it supports. Ask runners return `{ answer: string, used?: itemId[] }`.
- `apply` returns an undo record; `undo` receives it back. Core's own effects (rename, archive, delete, links) have built-in undo.

**Registering.** `ModuleManifest` gains `aiActions` (descriptions); `ServerModule` gains `aiRunners`. Core registers its own the same way. `collectServerModules` refuses to start if an action id lacks its module's prefix, a description has no runner or a runner no description, an id repeats, or an action lists an item type its module does not own (`"*"` and `"none"` are open to all).

**Effects and caps.** The highest kind an action may run as is worked out from its effects, not chosen by the module:

| Effects | Highest kind |
| --- | --- |
| none | Ask |
| `updateItem` on the current item | Do |
| `createItems` linked to the current item, `addLinks` from the current item | Do |
| `deleteItems`, `setArchived`, or any write to another existing item | Suggest |

`apply` runs through a writer that only offers the declared effects and checks every call against the current item. A call outside them throws, and the whole transaction rolls back.

**Core actions**

| Action | Applies to | Kinds | Effects | Notes |
| --- | --- | --- | --- | --- |
| `answer` | `*` and `none` | Ask | none | Free questions and summaries; the fallback when nothing else matches |
| `retitle` | `*` | Suggest, Do | `updateItem` | Suggest returns three options with reasons |
| `delete` | `*` | Suggest | `deleteItems` | Uses Core's soft delete, restorable for 30 days |

A module can define a more specific action for its own type (`tasks.retitle`); the interpreter prefers it on that type, and Core's stays for the rest.

## Interpreting requests

The interpreter turns typed text into an action and a kind, live as you type. It is a replaceable part:

```ts
// @dlh/core/ai/interpreter.ts
export interface RequestInterpreter {
  id: string;                                  // "keywords"; later e.g. "model:haiku"
  interpret(input: {
    text: string;
    itemType: string | null;
    actions: AiActionDescription[];            // already narrowed to what applies here
    signal: AbortSignal;
  }): Promise<Interpretation>;
}

export type Interpretation = {
  actionId: string;
  kind: AiKind;
  confidence: number;                          // 0–1; below 0.6 the row shows "Not sure"
  alternatives: { actionId: string; kind: AiKind }[];
  matched: boolean;                            // false for the no-match fallback; the bar then offers no AI
  source: string;                              // the interpreter's id, recorded in the log
};
```

- `interpreter` in `ai_settings` picks the implementation. Only `keywords` exists in this milestone.
- Safety never depends on the interpreter: the server re-checks the action, its item type and its cap on every run.
- A model interpreter would run on the server behind an `ai.interpret` procedure, give the model the applicable actions as `id` + `description`, and return the same `Interpretation`.

**The keyword interpreter**

1. Narrow to actions that apply to what is on screen.
2. Score each action: every matched `words` entry adds to its score, phrases count more than single words, actions specific to the item's type beat `"*"` ones, and a one-letter typo still matches in words of five letters or more. A tie or a narrow lead lowers confidence; the runner-up goes into `alternatives`. No match at all gives `answer`.
3. Read the wanted kind from the wording, checking in order: negation ("don't", "never") → unclear; asking for alternatives ("suggest", "ideas", "options", "a few", "what would be a good") → Suggest; a polite command ("can you", "could you", "please" + an action word) → Do; a question (question word first, a "?" at the end, "summarise", "explain", "tell me") → Ask; a leading verb → Do; anything else → unclear.
4. Reconcile: a kind the action does not support becomes its closest safe one (a question to `retitle` becomes Suggest); unclear becomes Suggest if the action has it, else its first kind; then the cap applies.

English only for now.

**Measuring interpreters.** Labelled phrasings live in test files (`packages/core/test/ai-phrasings.ts` for Core, `modules/<id>/test/ai-phrasings.ts` for modules): text, item type, expected action and kind. A shared test runs every interpreter against all of them and requires 90% accuracy, and `pnpm ai:eval-interpreter --interpreter=<id>` prints accuracy, the confusions and time per guess.

## Request flow

1. **Typing.** The interpreter updates Understood as. Tab cycles the kinds the action allows; ↑↓ picks an alternative while the bar lists no result rows. Nothing is sent yet.
2. **↵ (⌘↵ while result rows are listed) → `ai.prepare({ text, itemId, actionId, kind, interpretedBy?, provider? })`.** `interpretedBy` is the interpreter's id when its own action and kind run, and is left out when you picked either by hand. The server checks the action exists, applies to the item's type and allows the kind, and downgrades the kind to the cap if needed. It checks the provider is available, builds the context, notes the item's `updated_at` and creates the request row.
3. **Model call.**
   - OpenRouter: the server calls it in the same request and continues at step 4.
   - Claude Code or Codex: the server returns `{ requestId, system, prompt, schema }`. The app runs the CLI and posts the output to `ai.complete({ requestId, raw })`.
4. **Check.** The output is parsed as JSON and checked against the runner's schema for the kind. Failure ends the request as `failed` with `bad_output`.
5. **By kind.**
   - Ask: the answer is returned; status `answered`.
   - Suggest: the options are stored in `output` and returned; status `suggested`. `ai.applyOption({ requestId, option })` applies one, once.
   - Do: applied at once through the scoped writer with the noted `updated_at` as `expectedUpdatedAt`; status `applied`. Returns a one-line summary and the request id for Undo.
6. **Undo.** `ai.undo({ requestId })` runs the runner's `undo` with the stored record, once, and only while the items it changed have not been edited since; status `undone`.

Your text goes to the model as the instruction ("give this a shorter, more formal title"), but is not stored. Writes go through Core's writer, so other devices update through `/changes`.

**Context.** `itemContext` reads the item, its `search_text`, and its links and backlinks (titles, kinds and ids), trimmed to 12,000 characters, longest parts first. The title, type and id lines are never cut, and every link line keeps its id, so an Ask answer can list the items it `used`. A runner may add module fields. The context is sent to the provider and never stored.

## Data model

**`ai_requests`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | `uuidv7()` |
| `created_at`, `finished_at` | timestamptz | `finished_at` null while pending |
| `action_id`, `kind` | text | `kind` as run, after any cap |
| `interpreted_by` | text | The interpreter's id; null if you picked the kind by hand with Tab |
| `provider`, `model` | text | `model` null for CLI runs |
| `item_id` | uuid, null | References `items`, set null on purge |
| `item_version` | timestamptz, null | The item's `updated_at` at prepare |
| `status` | text | `pending`, `answered`, `suggested`, `applied`, `discarded`, `undone`, `failed`, `expired`, `cancelled` |
| `error_code`, `error_message` | text, null | Set when `failed` |
| `duration_ms`, `input_tokens`, `output_tokens` | integer, null | Tokens from OpenRouter only |
| `cost_usd` | numeric, null | From OpenRouter's usage report |
| `output` | jsonb, null | Suggest options; cleared when one is applied, discarded or expired |
| `undo` | jsonb, null | Do undo record; cleared after Undo or after 30 days |

Index on `created_at desc`. The typed text, prompt, context and Ask answers are never stored.

**`ai_settings`**: a single row: `default_provider` (`openrouter`, `claude-cli`, `codex-cli`), `openrouter_model`, `interpreter` (`keywords`), `updated_at`. Created on first read from the defaults below.

**On each device** (local storage): a program path override per CLI, and the last status check.

**Server config** (both optional): `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`. Without a key the server starts and reports OpenRouter as not set up. Defaults: provider `openrouter`, interpreter `keywords`.

## Rules

- **Expiry.** A pending CLI request expires after 5 minutes, an unpicked suggestion after 30. Expiry is checked on use; the purge job also marks old ones `expired`.
- **Purge.** Core's existing purge job deletes `ai_requests` rows older than 90 days and clears `undo` older than 30.
- **Staleness.** Do and `ai.applyOption` pass the noted `updated_at` to the writer; a mismatch ends the request as `stale` and writes nothing. Undo checks the changed items' versions the same way.
- **Single use.** Apply and Undo each succeed once per request; repeats are refused with `CONFLICT`.
- **Timeouts.** OpenRouter 60 seconds on the server; CLI runs 120 seconds in the app. No automatic retries.
- **Other provider.** "Use \<other provider>" runs the same request once with another provider and does not change the default.

## API

A core `ai` router (`ai` joins the reserved router names). All procedures are protected. The app reads action descriptions from the module manifests and works out caps with the shared `capFor(effects)`, so no procedure serves them.

| Procedure | Input | Output |
| --- | --- | --- |
| `ai.prepare` | `{ text, itemId?, actionId, kind, interpretedBy?, provider? }` | `{ requestId, status, answer? \| options? \| applied? }` or `{ requestId, run: { provider, system, prompt, schema } }` |
| `ai.complete` | `{ requestId, raw }` | As `ai.prepare`'s finished forms |
| `ai.cancel` | `{ requestId, error?: { code, message } }` | `{ ok }`. Ends a pending CLI request `cancelled`; with `error` (a failure on the app's side: timeout, not installed, too large, spawn failed, a non-zero exit with no output) it ends `failed` with that code and the message's first line. |
| `ai.applyOption` | `{ requestId, option }` | `{ summary }` |
| `ai.discard` | `{ requestId }` | `{ ok }` |
| `ai.undo` | `{ requestId }` | `{ summary }` |
| `ai.settings.get` / `ai.settings.set` | — / partial settings | Settings plus `providers: { id, available, reason? }[]` (server-side availability) |
| `ai.log.list` | `{ cursor? }` | Latest 50 requests, newest first, with `canUndo` |

tRPC reserves the procedure name `apply`, so the pick-an-option call is `ai.applyOption`.

Errors use the codes in Errors, sent as `{ code, message }` in the tRPC error's `data.ai`.

## Providers

```ts
export interface AiProvider {
  id: "openrouter" | "claude-cli" | "codex-cli";
  runs: "server" | "desktop";
  complete?(req: { system: string; prompt: string; schema: JsonSchema; model: string; signal: AbortSignal })
    : Promise<{ raw: string; usage?: { input: number; output: number; costUsd?: number } }>;
}
```

Only server providers implement `complete`; desktop providers are run by the app.

**OpenRouter** (`packages/server/src/ai/providers/openrouter.ts`): chat completions with structured JSON output from the schema, the model from settings, `fetch` passed in, a 60-second abort, usage and cost read from the response.

**CLI runner** (`apps/desktop/src-tauri/src/cli.rs`)

- Commands: `ai_cli_status(provider)` → installed, signed in, version; `ai_cli_run(runId, provider, system, prompt, schema)` → stdout and exit code; `ai_cli_cancel(runId)`.
- Only `claude` and `codex`, found at the device's path override, else on `PATH`, else in the usual install folders: `$HOME/.local/bin`, `$HOME/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, `$HOME/.npm-global/bin`, `$HOME/.bun/bin`. An override must be absolute and name a file called `claude` or `codex`.
- A fixed argument list per CLI: print mode, JSON output, tools turned off. The prompt goes on stdin. The exact flags are fixed in the plan and checked against the installed versions.
- Codex runs with `--sandbox read-only`, which still lets it read local files; until a verified way to turn its tools off exists, this is an accepted risk.
- Each run uses a fresh, empty temporary directory as its working directory, deleted afterwards.
- 120-second timeout and 1 MB output cap; both kill the process.
- No shell plugin and no general process permission; the capabilities test checks this.

## Desktop

**Command bar.** With an item open, typing shows an **Understood as** row above the results: an AI tile, the action's label, an Ask · Suggest · Do switch (only the kinds the action allows), and a line saying what that kind does and which provider runs it ("Changes it now, with Undo after · Claude Code"). Low confidence adds "Not sure". Keys: while the bar lists any result row (Jump to, Recents, Go to, actions), ↵ and ↑↓ keep working on the rows and ⌘↵ (Ctrl+↵ off macOS) runs the request; with no rows, ↵ runs it and ↑↓ picks an alternative. Tab switches kind, Esc closes. The footer shows which key asks AI ("⌘↵ to ask AI" or "↵ to ask AI"). `CommandBar` in `@dlh/ui` gains an `interpretation` slot for this row and a `result` slot that replaces the result rows.

- **Ask** shows the answer in the result slot, with the items it used as links and Copy.
- **Suggest** shows the options with their reasons, a Use button each and None of these; keys 1–3 pick.
- **Do** closes the bar and shows a status toast ("Claude Code is renaming…", Cancel), then a result toast with Undo and Show options. Show options runs the same request as Suggest.
- **Errors** show in the same place as the result, with the actions from Errors.

With no item open, only actions that apply to `"none"` are considered (in this milestone, `answer`).

**Settings → AI**: default provider with a status per provider (Ready, Not set up on the server, Not installed, Signed out) and Check again for the CLIs; the OpenRouter model; under Advanced, the interpreter and each CLI's program path; Recent requests from `ai.log.list` (when, action and kind, provider and model, duration, tokens or cost, result, Undo where possible).

## Errors

Every failure ends the request as `failed` (or `stale`, `expired`) and writes nothing.

| Code | When | Message | Offered |
| --- | --- | --- | --- |
| `bad_output` | Not JSON or fails the schema | "\<Provider>'s answer wasn't in the expected format, so nothing was changed." | Try again · Use \<other> |
| `timeout` | Past the provider's limit | "\<Provider> didn't answer within \<n> seconds." | Try again · Use \<other> |
| `provider_unavailable` | No OpenRouter key; CLI missing or signed out | "OpenRouter isn't set up on the server." / "Claude Code isn't installed on this computer." / "Claude Code isn't signed in. Run `claude` once in a terminal to sign in." | Use \<other> · Open Settings |
| `provider_error` | Error status or non-zero exit | "\<Provider> returned an error: \<first line>." | Try again |
| `stale` | Item edited meanwhile | "This item changed while \<provider> was working, so nothing was changed." | Run again |
| `expired` | Past its expiry | "This suggestion expired." | Run again |
| `not_found` | Item deleted meanwhile | "This item was deleted." | — |

## Testing

No automated test calls a real model.

- **Fakes:** `FakeProvider` in `@dlh/server/testing` returns valid, schema-failing, non-JSON, slow or error outputs per action; the OpenRouter client is tested against an injected `fetch`; a fake CLI runner stands in for the Rust command in app tests.
- **Unit:** the shared interpreter suite and its safety rules (negation, caps, fallback); caps from effects; registration checks; output schemas; the OpenRouter client's request, usage and error mapping; the eval command runs.
- **Database, through `createTestApi`:** each kind end to end, including the `/changes` event and Undo; caps applied when the app asks for more; stale writes refused; a runner writing outside its effects rolls back; the CLI handshake (prepare, complete, bad output, expiry, unknown and finished requests); the log never holds the typed text or prompt; `output` and `undo` cleared on time; purge; settings round-trip and server start without a key.
- **Rust:** the allowlist and path checks, fixed arguments with the prompt on stdin, timeout and output cap kill the process (with a stand-in script), the temporary directory is cleaned up; the capabilities test also rejects shell and process permissions.
- **End to end (Playwright, fake provider):** rename with Do and Undo; Suggest and Use; "delete this" shown first and cancelled; a bad answer shows its message.
- **Manual Done check:** `pnpm ai:smoke` runs `answer` and `retitle` on a seeded item through each provider available on the machine and prints the result and log row.

## Decisions

- **Three kinds instead of confirm-before-write.** A direct request is done at once with Undo; suggestions wait for a pick; deletes and changes to other items always show first. Safety comes from caps worked out from effects and a writer limited to them, not from asking every time.
- **Two-step handshake for CLIs.** The server builds every prompt and checks every answer; the app only runs the CLI. One code path from the check onward for all providers.
- **Keywords first, behind an interface.** Instant, offline and testable; a model interpreter can be tried later with `ai.interpret` and compared with the eval command.
- **Descriptions, not examples.** Actions carry a plain description of what they do and when; labelled phrasings for tests live in test files.
- **Nothing you type is stored.** The log records what ran and how it went; only Undo keeps old values, for at most 30 days.
- **Settings split by scope.** Provider, model and interpreter on the server; CLI paths and status per device.
