# Slack Bot — Deep-dive Spec

Nov 6, 2026 · Arek · Draft

## Scope

Talk to the hub from Slack, and let coworkers reach you through it. You DM the bot to ask about your tasks and queue, capture things and hand work to the agent. The bot never writes or sends a message as you. Coworkers DM or @mention it to leave you requests, ask what involves them and ask for reviews; it answers them on its own from what involves them, and escalates to your queue when it isn't sure. It also lays the shared Slack base (one Slack app, one always-on service) that Slack intake and notifications reuse later. Part of the [Digital Life Hub overview](../overview.md); builds on the [Queue](requests.md), the [AI gateway](ai-gateway.md) and the [Agent hub](agent-hub.md).

**In scope**

- The Slack app (Socket Mode) in your work workspace: a bot token and an app token
- `apps/slack`: a thin always-on service that receives Slack events, calls the API, and posts what it returns
- `modules/slack`: settings, the people map, the outbox, its operations and Settings → Slack
- A model interpreter (Jev, through Vercel AI Gateway) that picks the action, kind and subject for a message
- Escalation: anything the interpreter isn't sure of goes to your queue with its candidates as buttons
- Your side: ask, capture, Undo, handing work to the agent
- Coworkers' side: leave a request (several quick messages become one), ask what involves them, withdraw, ask you or the agent for a review
- Asker-scoped lookups and coworker-audience agent runs: anything answering a coworker sees only what involves them, or what you approved
- Core: a `slack` principal, running the gateway and operations as you from module code, `audience: "asker"`
- Queue: `requests.append`. Agent hub: run audience, a coworker connection set, posting through the hub

**Out of scope**

- Slack intake (watching channels you didn't mention the bot in) and notifications. They get their own specs and reuse `apps/slack`, the Slack app and the outbox
- The GitHub module itself. The bot uses three of its operations (see Depends on); its feature set is the [GitHub spec](github.md)'s
- More than one workspace
- Slack Connect users (people from other workspaces). Ignored
- Calendar answers ("when is Arek free?"). Added as an asker lookup once Events exists
- External Undo. A GitHub write is confirmed before it runs instead
- A People model. `slack_people` maps Slack users to GitHub logins and nothing more
- Posting as you. No user token: the bot drafts and sends nothing under your name

**Done when**

1. From your phone, "remind me to chase Dana Friday" makes a task, and Undo in Slack removes it.
2. A coworker's three quick DMs become one request holding all three, and they get one acknowledgement.
3. "Did Arek see my request?" gets the right status, and "never mind" withdraws it.
4. "@ArekBot how many open PRs does Arek have for me?" is answered correctly, with nothing in the answer that doesn't involve the asker.
5. An ambiguous message, yours or a coworker's, lands in the queue as "Bot wasn't sure"; for a coworker's, running a suggested action there completes it and replies in Slack.
6. "Have the agent do X" in your DM starts a run with no further confirm, and its report comes back to that DM.
7. A coworker's request handed to the agent runs with coworker audience: it can reply in their DM on its own, and asking to read anything else of yours files an approval.
8. Restarting `apps/slack` loses no coworker message, escalation reply or agent post.

## Decisions

| Topic | Decision |
| --- | --- |
| Shape | A thin `apps/slack` service plus `modules/slack` in the API, like `apps/agent` and `modules/agent`. The service holds the Slack tokens and no AI and no database |
| Transport | Socket Mode. No public URL |
| Workspace | Your work workspace. A bot token and an app token. No user token |
| AI for the bot | The light gateway, already in the API. `modules/slack` calls its code directly, as you; `apps/slack` never calls `ai.*` |
| Interpreting | A model interpreter on Jev through Vercel AI Gateway. Jev picks; it writes no text. The gateway's generative model fills inputs and writes answers |
| Unsure | Below the threshold (0.6), or no match: escalate to your queue with the candidates as action buttons. Never a guess, never a "Did you mean" in Slack |
| Coworkers | Interpreted too, against a small coworker command set. The bot answers them on its own, as the bot |
| What a coworker can learn | Only what involves them: their requests, and asker-scoped lookups (`audience: "asker"`). Bounded by what the model can see, not by reviewing what it writes |
| Several messages | File the first at once, then append later ones from the same sender in the same DM or thread within 15 minutes while the request is open |
| Posting as you | Never. Everything the bot or the agent posts is as the bot |
| Handing off | Your "have the agent do X" is the approval. It runs at once, with Undo until claimed and Cancel after |
| Agent replies to coworkers | Free, as the bot, to the thread the request came from, because a coworker-audience run can only read what involves them. Anything wider is an approval of the action, not of the message |
| Posting from elsewhere | Everything not a direct reply goes through `slack_outbox`; `apps/slack` sends it. No other process holds a Slack token for this |
| GitHub writes | Capped at Suggest (confirmed before running), so they need no external Undo |
| History | Slack keeps the conversation. The hub stores no chat turns; the gateway's request log records every AI request |

## Packages

```
apps/slack          NEW: Bolt app in Socket Mode, the slack-token API client, the outbox sender
modules/slack       NEW: slack_settings, slack_people, slack_outbox, slack_actions; operations; Settings → Slack
modules/requests    + requests.append, requests.fromSender, appended_ids, from_owner
modules/agent       + run audience and guard, coworker connection set, agent.recentRuns, agent.runSource, hub-call approvals
packages/core       + access "slack", audience "asker", run guards, runId checks, the shared approval hash, the model interpreter's contract (subjects)
packages/server     + slack principal, the model interpreter, the Vercel AI Gateway provider (prerequisite)
packages/agent-runner + out-of-audience hub calls are ask
apps/api            + slack tokens on tRPC and /changes; pnpm api slack-token
deploy/vps          + the slack service
```

**How they talk**

- `apps/slack` talks to Slack (the socket and the Web API) and to the API with a **slack token**. It calls only `slack` operations and listens on `/changes`.
- `apps/agent` and the desktop app are unchanged. A run posts to Slack by calling `slack.postToSource` through its hub tools; it never gets the bot's token.
- `apps/slack` and `apps/agent` never talk to each other.

## The Slack app

One app, installed by a workspace admin.

| Token | Scopes | Used for |
| --- | --- | --- |
| App (`xapp-`) | `connections:write` | The Socket Mode connection |
| Bot (`xoxb-`) | `app_mentions:read`, `im:history`, `im:read`, `im:write`, `channels:history`, `groups:history`, `chat:write`, `reactions:write`, `users:read`, `users.profile:read` | Receiving DMs and mentions, reading the thread it was mentioned in, replying, opening a DM for a review ping, names and the GitHub profile field |

Events: `message.im` and `app_mention`. The bot reads a channel thread only when it is mentioned in it, for context. It subscribes to no channel messages.

Config, in `apps/slack`'s environment: `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `HUB_API_URL`, `HUB_SLACK_TOKEN`. The API needs no Slack secret.

## Who is speaking

`apps/slack` classifies every event before it calls the API:

1. A bot message (`bot_id` set), its own post, an edit, a delete or any other `subtype`: ignored.
2. A user from another team (Slack Connect): ignored.
3. `user` equals `slack_settings.owner_slack_id`: **you**.
4. Anyone else in the workspace: a **coworker**.

Socket Mode is an authenticated connection, so the sender's user id is trusted as sent. The API trusts what `apps/slack` says about the sender because only `apps/slack` holds a slack token.

**Context.** With each message `apps/slack` sends the last 10 messages before it: the DM's history (`conversations.history`), or the thread's (`conversations.replies`) when the message is in a thread. Each carries who sent it (you, the bot, the coworker) and, for the bot's messages, the `ai_request_id` from the message's Slack `metadata`.

## Interpreting messages

The model interpreter lives in `modules/slack/src/server/interpret.ts`. It is server-only: it is not a second implementation of the gateway's `RequestInterpreter`, and the client's `interpreters` registry is unchanged. It calls Core's `decideOnServer`, through Vercel AI Gateway, configured to Jev. Jev is a decision model: it is given options and returns a pick with a confidence, and writes no text.

**What it picks.** A coworker's message is one decision. Your message is two.

| Decision | Options supplied | Asked |
| --- | --- | --- |
| Which command (coworkers) | The coworker command set, each as `value` + `description`, which includes `escalate` | Always |
| Which action and kind (you) | Every AI action the gateway has, crossed with each kind it allows, as `"<actionId>\|<kind>"`, plus `slack.handOff\|do`, `slack.reply\|do` and `escalate` | Always |
| Which subject (you) | Up to 5 items from full-text search on the message text, plus `none` | Only when the picked action applies to items |

Both are `choice` questions to Jev. The interpreter's result has `subjectId: string | null`. In Part 1 only the coworker set is used, and it has no subjects. Below `slack_settings.threshold` (0.6) on either decision, a pick of `none` for an action that needs an item, or a pick of `escalate`, the message escalates. The server re-checks the action, the subject's type and the cap as it does for ⌘K; safety never depends on Jev.

**Command sets**

| You | Coworkers |
| --- | --- |
| Every AI action the gateway has (Core's and modules', so `tasks.create`, `answer`, `requests.makeTask`…) | `leaveRequest`: file a request (the default) |
| `slack.handOff`: give the message's work to the agent | `addToRequest`: append to their open request (see Several messages) |
| `slack.reply`: reply in words, with nothing looked up or changed (greetings, thanks, what the bot can do, common knowledge) | `requestStatus`: their requests, open or resolved, and when |
| | `withdraw`: resolve their open request as `handled` |
| | `askAbout`: answer from an asker-scoped lookup (`github.prsBetween`, their requests) |
| | `requestReview`: ask you to review their PR |
| | `requestAgentReview`: ask for an AI review of their PR (always escalates) |
| | `escalate`: something only you can answer |

**Running.** Once picked, the gateway runs the action as it does for ⌘K: the generative model fills the input and writes any answer, the output is checked, and a Do applies with Undo. `modules/slack` runs it as you (see The owner path in Core changes).

**The bot's profile.** Both models on your path start from one system prompt (`owner/profile.ts`): whose bot it is, the gateway's actions (read live, so it never goes stale), what the agent can do (review a pull request, fix a bug, research, multi-step jobs) and what the bot can't (post as you, check live outside information). Jev uses it to tell "can you review PRs?" (a reply) from "review this PR" (`slack.handOff`, which takes code and PR work even when the message doesn't name the agent).

**Replies to you in words.** `slack.reply` is for a message that needs no tool: nothing to look up, nothing to change. The model sees only the bot's profile and your conversation with the bot, and is told never to claim it did something or to invent your items. It files nothing. If the model can't reply, the bot sends a fixed help text instead. Anything that needs current outside information (weather, prices) or your own judgement still escalates.

**Coworker answers.** `askAbout` and `requestStatus` reply in words written by the model, as the bot. Their prompt is built by one fixed context builder that holds only the conversation with that coworker and the result of the lookup Jev picked. It gets no item search, no tools and no other context, so a prompt like "summarise Arek's tasks" has nothing to draw on. The rest of the coworker set replies with fixed templates.

**Rules only.** `slack_settings.coworker_ai` off sends no coworker text to Jev: every coworker message is `leaveRequest` or `addToRequest` by the time rule. If Jev fails or times out (3 s), the message is handled the same way.

## Escalation

A coworker's escalated message files a request, through `requests.file` called by `slack.handleMessage`:

- `source: "slack"`, `externalId` `<channel>:<ts>`, `sourceUrl` the message's permalink, `fromName` and `sourceHandle` the sender's
- Title "Bot wasn't sure: \<first line\>", body the message
- **A coworker's** escalation carries up to 2 actions from Jev's top candidates in the coworker command set, each labelled with what it does: "Keep as a request", "Add to their request", "Reply with their status", "Withdraw their request" or "Answer their question". Each runs `slack.runEscalated({ slackUserId, externalId, command })`, which runs the action as you, resolves the request as `handled`, and puts the reply into the outbox for the source thread. The message is named by its sender and `<channel>:<ts>`, which exist before the request does
- A coworker's last action, Neither, runs `slack.dismissEscalation({ slackUserId, externalId })`: it resolves the request as `not_for_me`, kept for tuning the threshold. Actions replace the three outcomes on screen (Queue spec), so this stands in for them

**Your** escalation files nothing: you are already in the DM, and filing your own message back to you loses the conversation that gives it meaning. The bot asks you there instead: "Not sure what you meant. Could you say it another way? If it's work for the agent, say \"give it to the agent\"." A coworker gets the normal acknowledgement and never sees the bot's uncertainty.

## Message flows

**You (DM, or @mention in a thread)**

1. `slack.handleMessage` interprets and runs. It runs inside a mutation's transaction and writes nothing through `w`: each step that must commit on its own goes through `deps` (see Core changes).
2. The reply depends on the kind: Ask, the answer; Suggest, the options as buttons; Do, "Done: …" with Undo. Every reply carries its `ai_request_id` in the message's metadata and buttons.
3. A button calls `slack.handleAction`, as you: apply an option, discard the options ("None of these"), undo, undo a handoff, or Cancel run.

**Coworkers (DM, or @mention)**

1. `slack.handleMessage` interprets against the coworker set.
2. `leaveRequest` files a request and replies with `slack_settings.ack_text` ("Got it, I've passed this to Arek."). `addToRequest` appends and reacts with 👀.
3. `requestStatus`, `askAbout` and `withdraw` answer from their own requests or an asker lookup.

**Several messages.** A coworker's message is `addToRequest` when they have an open request filed from the same DM or thread less than `slack_settings.append_minutes` (15) ago. The rule reads `source_handle`, the channel in `external_id`, and `received_at` through `requests.fromSender`. Jev still chooses between appending and a new request when both apply.

**Handing off to the agent**

1. "Have the agent do X" in your DM: Jev picks `slack.handOff`.
2. `handOff` is a step of the owner path, not an operation, so a run can't hand work to the agent. It files a request for the message (`source: "slack"`, `fromOwner: true`, `sourceUrl` your DM's permalink), then runs `agent.assignRequest` on it. Both run through `runMutation(deps, op, input)`, each in its own transaction, so the request is committed before `assignRequest` reads it. `handOff`'s own Undo token is stored in `slack_actions`.
3. Reply: "Given to the agent: \<task title\>" with Undo (until the worker claims the run) and Cancel run. Cancel runs `agent.cancel` the same way.
4. When the run ends, its report comes back to that DM (see Agent hub changes).

Give to agent on any request in the queue works as it does today.

**Reviews** (need GitHub v1)

| Who asks | What happens |
| --- | --- |
| A coworker asks you (`requestReview`) | The PR must be theirs (their GitHub login from `slack_people`), else escalate. Files "Review #456 for Dana" with the PR's title, size, CI status and link from `github.pr`. Acknowledges |
| You ask a coworker ("ask Dana to review #123") | `github.requestReviewers` is capped at Suggest: "Request a review from Dana on #123?" with Do it. On Do it, the reviewer is added on GitHub, and a ping ("Arek asked you to review #123", the link) goes into the outbox as the bot, to Dana's DM |
| You ask the agent ("have the agent review #123") | `handOff` with the task "Review PR #123" and the `github` connection. The run posts its review on GitHub on its own (`gh pr review` is alone) |
| A coworker asks the agent (`requestAgentReview`) | Always escalates: "AI review of #456 for Dana" with the actions Start AI review (`agent.assignRequest`, the task preset, the coworker connection set) and Decline (`slack.decline`, which resolves the request as `not_for_me` and sends a fixed "Arek declined this one"). Dana gets "Sent to Arek for approval". The run has coworker audience |

## Core changes

**Slack principal.** `Principal` gains `{ kind: "slack"; tokenId }`, a service token of kind `slack`, minted by `pnpm api slack-token` (printed once, stored as its hash). `OperationAccess` gains `"slack"`: callable only by a slack token. `ALLOWED.slack` is `{"slack"}`; `everyone` and `user` don't let it in. `describeOperation` refuses `access: "slack"` unless `palette: false` and `ai: false`. `/changes`' `mayListen` accepts a live slack token.

**Running as you from module code.** The owner path calls the gateway's `prepare(deps, input, { origin: "slack" })`, `apply` and `undo`, and `runMutation(deps, op, input)`, directly, each in its own transaction, with your writer, Undo tokens and request log, exactly as the desktop app's calls would. `prepare` writes the new `ai_requests.origin` column (`app` by default, `slack` here), and `slack.handleAction` acts only on `ai_requests` rows with `origin = 'slack'` and on `slack_actions` rows.

**The owner path.** `handleMessage` runs inside a mutation's transaction, and everything you ask for must commit on its own. So each step runs through `deps`, as you: the gateway's `prepare`, `apply` and `undo` (each opens its own transaction), and `runMutation(deps, op, input)` for `requests.file`, `agent.assignRequest` and `agent.cancel`. The owner path leaves no write in the outer transaction.

**Undo for the bot's own operations.** The gateway keeps Undo for what it runs. For operations the bot runs outside it, `slack_actions` holds the Undo token (`agent.assignRequest`'s, from a handoff). A button's value is a `handleAction` input naming an `ai_requests` id or a `slack_actions` id, never a raw token. Undo is single use.

**Model interpreter.** It is server-only. It lives in `modules/slack/src/server/interpret.ts` and calls Core's `decideOnServer`. ⌘K keeps the keyword interpreter, and Core's client registry (`interpreters`) is not changed. Its result has `subjectId`. The phrasing suite runs against it, at the same 90% bar. Your command set has subjects (Part 2); the coworker set has none. Its alternatives are the next most probable choices.

**Server-side model calls.** Core has two helpers for module server code. Both log the call in `ai_requests` with `origin: "slack"` and `action_id` = `purpose`. The gateway's `prepare` is not involved; the owner path's gateway steps are unchanged.

- `completeOnServer(deps, { purpose, system, prompt, schema, model?, timeoutMs? })` returns `{ value, requestId }`. It generates text, such as a coworker's answer, through chat completions on the configured server provider.
- `decideOnServer(deps, { purpose, question, choices: { value, description }[], input, model, timeoutMs })` returns `{ choice, confidence, probabilities, requestId }`. It is the interpreter's call, through `/v1/decisions` on the Vercel provider (its `decide()` method). Decision models (Jev, Luna) are not reachable through chat completions. It reads `confidence`, not the top probability.

**Asker audience.** `OperationDescription.audience?: "asker"` marks an operation whose output is only what involves one person. It takes `asker: { slackUserId: string; githubLogin: string | null }` as input and must filter on it. Operations never see their caller, so the API vouches for the asker: the operation must be `access: "slack"` or `"everyone"`, and it is called with the sender `apps/slack` reported, through an operation call from such an operation, or by a run whose audience it is. A coworker-audience run's `asker` input must equal the run's audience; the coworker context builder and coworker-audience runs may call only these. An `audience: "asker"` operation may be `access: "slack"` or `"everyone"`, so a run can call it. `describeOperation` refuses one whose `asker` input accepts `undefined` or `null`. `requests.fromSender` is `access: "everyone"`, `palette: false`, `ai: true`, so the agent runner exposes it as a hub tool; the agent's guard limits its `asker` to the run's audience. A test asserts each one returns nothing for an unrelated asker.

**Run identity.** Operations never see their caller. A run identifies itself in the input: when an operation's input has a `runId` key, Core requires a run token's call to carry `input.runId` equal to its own run, and the worker fills `runId` into such calls itself. `slack.postToSource({ runId, text })` relies on this.

**Run guards.** `defineServerModule(desc, { runGuard })`, where `runGuard(deps, { runId, operation, input }): Promise<void>` throws `FORBIDDEN` to refuse. Core calls every module's guard for a run principal before the operation runs. The agent module's guard enforces audience and consumes one-time hub approvals.

**The approval hash.** `canonical`, `inputHash(tool, input)` and `hubToolName(operationId)` (`mcp__dlh__hub__<module>_<key>`) live in `@dlh/core`, and `@dlh/agent-protocol` re-exports them. Approving a hub call and checking it later use the same hash.

**Vercel AI Gateway provider** (prerequisite, the separate change the overview already plans). It is a second server provider, not a rename. `aiProviderId` gains `"vercel"`, and `createOpenAiCompatible` serves both `createOpenRouter` and `createVercelGateway`. The server uses `vercel` when `AI_GATEWAY_API_KEY` is set, else `openrouter`. `ai_settings.openrouter_model` still applies only to OpenRouter. Jev and the generative model both go through the Vercel provider.

## Queue changes

- `requests.appended_ids` text[], default `{}`.
- `requests.from_owner` boolean, default false. `requests.file` takes `fromOwner?: boolean`; Slack sets it for your messages, so the agent can tell your requests from a coworker's without reading Slack's tables.
- `requests.append({ id, key, text, at })`: adds a blank line and the text to the body, records `key` (the message's `<channel>:<ts>`) in `appended_ids`, bumps the version. A key already in `appended_ids` changes nothing. A resolved request is `CONFLICT` "Already resolved". `palette: false`, `ai: false`; called by `slack.handleMessage`.
- `requests.fromSender({ asker, openOnly?, since? })`: a query, `audience: "asker"`, `access: "everyone"`, the Slack requests whose `source_handle` is the `asker.slackUserId` input, with their status and resolved time.

## Agent hub changes

These change the [Agent hub spec](agent-hub.md); it links here.

**Run audience.** `agent_runs.audience` jsonb, null for you, `{ asker: { slackUserId: sourceHandle, githubLogin: null } }` for a run whose request has `source = 'slack'` and is not `fromOwner`. `assignRequest` sets it from the request, and `assign` from the request the task was made from (`requests.madeFrom`), each time; `claim` passes it to the runner. No run may file a request with `fromOwner`, a source other than the agent, a sender or a message id.

A coworker-audience run, alone:

| May | Only |
| --- | --- |
| Read the hub | `audience: "asker"` operations, and its own task and request |
| Write the hub | Its own task, filing requests for you, `slack.postToSource` |
| Use connections | `agent_settings.coworker_connection_ids`, chosen in Settings → Agent (default: none) |

Any other hub call is ask: the run suspends with an approval quoting the call ("Read your note 'Reorg plan'"), as for any ask. Approve adds `{ tool, inputHash, usedAt: null }` to `agent_runs.hub_approvals`, where `tool` is the hub tool's name (`hubToolName`). The agent module's run guard recomputes the hash from the call and consumes a match, so the call is accepted once from the run's token. The guard refuses (`FORBIDDEN`) any other out-of-audience call from a coworker-audience run's token; the runner's hook is the guide, the API the limit. Grants work as today, from the whole connection list.

**Posting to Slack.** `slack.postToSource({ runId, text })`, callable by a run token, posts as the bot to the thread or DM the run's request came from. It finds the request with `agent.runSource({ runId })`, refuses a request not from Slack, and puts the post in `slack_outbox` as `approved`. At most 5 posts per run and 2,000 characters each. It is the agent's only way to post into a DM with the bot; its own `slack` connection keeps posting in channels under the existing rule.

**Posting as you.** The alone/ask table's "Slack messages, as the bot or as you, to the people and threads the task came from" becomes "as the bot". A run never posts as you.

**Reports.** Two queries with `palette: false` and `ai: false`, reached through operation calls:

- `agent.recentRuns({ since })` lists runs that ended (`done` or `failed`) after `since`, with their task, request id, report and failure message. `slack.syncRuns` uses it.
- `agent.runSource({ runId })` returns the run's request id.

**Hub calls carry `runId`.** A run's hub calls to operations with a `runId` input are filled in by the worker, and Core checks them (see Run identity).

**Prompt.** A coworker-audience run's prompt says that the coworker reads what it posts, and which reads need approval. Its instruction is fixed ("Handle the request from <sender> quoted below. Reply with postToSource."); the task's title and notes are quoted as data with the message, never given as the task.

## Data model

`modules/slack`. Foreign keys to `items` cascade.

| Table | Columns | Notes |
| --- | --- | --- |
| `slack_settings` | One row: `team_id`, `bot_user_id`, `owner_slack_id`, `ack_text`, `threshold` (0.6), `append_minutes` (15), `interpreter` (`model:jev`), `coworker_ai` (true), `runs_synced_at`, `seen_at` | Set in Settings → Slack. `seen_at` is set by `pendingSends` on every poll and shown as "Bot last seen". `owner_slack_id` is required before the bot answers anyone; until then it replies "Not set up yet" |
| `slack_people` | `slack_user_id` (key), `name`, `github_login` null, `github_from` (`profile` or `manual`), `updated_at` | Filled from the Slack profile's GitHub field on first contact, or set by you. A manual login is never overwritten |
| `slack_outbox` | `id`, `key` unique, `origin` (`agent`, `report`, `review_ping`, `escalation`), `channel_id`, `thread_ts` null, `text`, `status` (`approved`, `sent`, `failed`), `request_id` FK `items` null, `run_id` null, `error` null, `sent_ts` null, `created_at`, `approved_at`, `sent_at` | Every row is posted as the bot. `key` makes every insert idempotent: `report:<runId>`, `agent:<runId>:<n>`… |
| `slack_actions` | `id` uuid, `operation` text (e.g. `agent.assignRequest`), `token` jsonb (an operation Undo token), `run_task_id` uuid null (the task whose run a handoff started), `created_at`, `used_at` null | Undo for operations the bot runs outside the gateway. A button's value names a row, never a raw token. `used_at` makes it single use |

The hub keeps no copy of Slack conversations. `requests.from_owner` and `agent_runs.hub_approvals` are described in Queue changes and Agent hub changes.

## Operations (Slack)

| Operation | Access | Does |
| --- | --- | --- |
| `handleMessage({ event, sender, context })` | slack | The entry point for every message. Returns `{ reply?, react? }` for `apps/slack` to post |
| `handleAction(input)` | slack | A Slack button. `input` is one of `{ do: "apply", aiRequestId, option }`, `{ do: "discard", aiRequestId }`, `{ do: "undo", aiRequestId }`, `{ do: "undoAction", slackActionId }` or `{ do: "cancelRun", taskId }`. Every reply button's value is that input as JSON |
| `pendingSends()` | slack | A mutation. Records `slack_settings.seen_at`, marks `approved` rows older than 24 hours `failed` with "Too old to send" (so escalation replies queued while no sender existed never go out days late), and returns up to 20 `approved` rows, oldest first |
| `markSent({ id, ts })` / `markFailed({ id, error })` | slack | Outbox results |
| `syncRuns()` | slack | For runs ended since `runs_synced_at` whose request came from your DM, adds a `report` row to the outbox |
| `runEscalated({ slackUserId, externalId, command })` / `dismissEscalation({ slackUserId, externalId })` | user | Request actions on an escalation. The message is named by its sender and `<channel>:<ts>` |
| `decline({ requestId })` | user | Request action on a coworker's AI-review request |
| `postToSource({ runId, text })` | everyone, run tokens only | See Agent hub changes |
| `settings`, `setSettings`, `people`, `setGithubLogin` | user | Settings → Slack |

## apps/slack

- **Events.** Bolt in Socket Mode. Every event is acknowledged at once, then handled: classify the sender, fetch the context, call `slack.handleMessage`, post the reply in the same thread (a DM reply is threaded only if the message was).
- **Outbox.** Listens on `/changes`; on a change, and every 30 seconds, it calls `slack.syncRuns`, then sends `pendingSends()` in order, as the bot, and reports each with `markSent` or `markFailed`. A review ping opens the DM with `conversations.open`.
- **Restart.** Socket Mode redelivers unacknowledged events. On start the outbox loop runs at once, so escalation replies and agent posts queued while it was down go out.
- **Nothing stored.** No database, no AI key. Its only secrets are the two Slack tokens and its slack token.
- **Compose.** One more service in `deploy/vps`, on the compose network with the API.

## Screens

- **Settings → Slack.** Connection status ("Bot last seen", from `slack_settings.seen_at`), your Slack user, the acknowledgement text, the threshold, the append window, "Coworker messages use AI" and the people list with GitHub logins.
- **Settings → Agent** gains the coworker connection set.
- **Queue rows.** A coworker's "Bot wasn't sure" request shows its candidates as action buttons, like the agent's approvals. Yours shows the usual three outcomes.

## Errors

| Case | What happens |
| --- | --- |
| API unreachable | You: "Can't reach the hub right now." A coworker: filing is retried after 1, 4 and 15 seconds, then "Couldn't pass this on, please try again later." Never an acknowledgement for something not filed |
| A redelivered event | `requests.file` and `requests.append` are idempotent on `<channel>:<ts>` |
| Jev fails or times out | A coworker's message is filed or appended by rule; yours escalates |
| Interpreter unsure | Escalation |
| Undo after the item changed | The gateway's "Changed since" |
| Undo of a handoff after claim | "Changed since"; Cancel run is offered |
| A send fails (archived channel, revoked token) | The row is `failed` with the error |
| No GitHub login for a coworker | "I don't know your GitHub account yet", and the message escalates |
| A PR that isn't theirs (`requestReview`) | Escalates |
| A run posts a 6th time, or more than 2,000 characters | `BAD_REQUEST`; the run is told why |
| A coworker-audience run calls outside its audience | `FORBIDDEN` unless approved; the hook asks first |
| Not set up (`owner_slack_id` empty) | "Not set up yet" to everyone |

## Testing

- **Unit:** sender classification; the append rule; the reply blocks for Ask, Suggest, Do and escalation; the Slack permalink to `channel:ts` parsing, the same format `slackChannelOf` reads.
- **Interpreter:** the model interpreter runs the existing phrasing suites plus `modules/slack/test/ai-phrasings.ts` (your Slack phrasings) and `modules/slack/test/coworker-phrasings.ts`, at 90%. `pnpm ai:eval-interpreter --interpreter=model:jev` reports them.
- **Database (`test:db`):** `handleMessage` files once and appends once per message; `append` refuses a resolved request; a slack token is refused by every operation not marked `slack`, and by `ai.*` and `ops.undo`; `handleAction` refuses an AI request the bot didn't start; the coworker path never builds context with search; every `audience: "asker"` operation returns nothing for an unrelated asker; `handOff` runs `assignRequest` and its Undo; a coworker-audience run's token is refused out of audience and accepted once after approval; `postToSource` refuses a non-Slack request, a 6th post and a long one; outbox keys make `syncRuns` idempotent.
- **`apps/slack`:** a stub Slack Web API and socket against `testServer` with the scripted dev AI: events to replies, the outbox loop, restart catch-up, retries when the API is down.
- **Manual:** the Done when list, in the real workspace.

## Build order

1. Prerequisites: the Vercel AI Gateway provider (its own small change), and a throwaway Jev check: its latency and accuracy on the phrasing suites, through the Gateway.
2. Core: the slack principal and access, `/changes`, `audience: "asker"`, the model interpreter.
3. Base and coworkers: the Slack app, `apps/slack`, `modules/slack` settings and people, `requests.append` and `fromSender`, the coworker command set, escalation, the compose service.
4. You: your command set, replies, Undo, escalation of your messages. (built)
5. Outbox: `handOff`, reports, and the Agent hub changes (run audience, `postToSource`, hub-call approvals). (built)
6. Reviews and PR lookups, once GitHub v1 exists.
7. End to end, docs, and the manual Done check.

## Depends on

- **[GitHub](github.md)** v1 provides: `github.prsBetween({ asker })` (`audience: "asker"`: the open PRs involving you and the asker), `github.pr({ ref })` (title, size, CI status, reviewers, link) and `github.requestReviewers({ pr, reviewers })` (a write capped at Suggest). Only step 6 waits for it.
- **Vercel AI Gateway** with Jev available on the account.
- **A workspace admin** approving the Slack app with the scopes above.

## Jev check results

Nov 6, 2026. 30 coworker messages (5 that should escalate) against the 8 coworker commands, 3 runs each (90 calls), from a laptop through Vercel AI Gateway.

| Question | `typesafe-ai/jev` | `openai/gpt-6-luna-decisions` |
| --- | --- | --- |
| Reachable through chat completions with `response_format`? | No. The Gateway answers 400 `ModelTypeMismatchError`: a decision model, not a language model | No, same error |
| Reachable through `POST /v1/decisions` with a `choice` question? | Yes | Yes |
| Choice limited to the supplied options? | Yes: `choice` is one of the supplied `value`s, with `probabilities` per option | Yes |
| Confidence returned? | Yes, `confidence` on the choice | Yes |
| Accuracy | 93% (28 of 30) | 80% (24 of 30) |
| Latency p50 / p95 | 166 ms / 234 ms | 292 ms / 610 ms |
| Cost per message | $0.000022 | $0.000028 |

What it means for the build:

- **Endpoint.** Decision models are not reachable through `/v1/chat/completions`, so a `response_format` schema doesn't apply. `createVercelGateway` calls `POST https://ai-gateway.vercel.sh/v1/decisions` with `Authorization: Bearer <AI_GATEWAY_API_KEY>` and `Content-Type: application/json`. The model id goes in the body's `model`, the message goes in `input` as a plain string, and the commands are the `choices` of one `choice` question, `escalate` among them. A `choice` question is the enum: the answer is always one of the supplied `value`s. Request body (the message is made up; the real check offered all 8 commands):

  ```json
  {
    "model": "typesafe-ai/jev",
    "input": "Could you chase the vendor about the invoice?",
    "questions": [{
      "type": "choice",
      "name": "actionId",
      "instructions": "A coworker sent this Slack message to the owner's bot. Pick the command that handles it.",
      "choices": [
        { "value": "leaveRequest", "description": "file a request for the owner" },
        { "value": "escalate", "description": "needs the owner's own judgement" }
      ]
    }]
  }
  ```

  The part of the response the build reads (the real response also carries `usage` and routing details):

  ```json
  {
    "answers": [{
      "type": "choice", "name": "actionId", "choice": "escalate", "confidence": 0.4,
      "probabilities": [
        { "value": "leaveRequest", "probability": 0.3 },
        { "value": "escalate", "probability": 0.7 }
      ]
    }],
    "usage": { "input_tokens": 342, "output_tokens": 40, "total_tokens": 382 },
    "provider_metadata": { "gateway": { "cost": "0.000014364" } }
  }
  ```

  The build reads `answers[0].choice`, `answers[0].confidence` (not the top probability, which differs: 0.4 against 0.7 here), `usage` and `provider_metadata.gateway.cost`. The check sent only the one message. In the build the last 10 messages of the conversation go into `input` too; Task 9 decides the exact layout. The `cost` figures in the table are that field. The Gateway response also lists `gatewayCost`, which on the team used for the check was higher because of account-level surcharges (zero-data-retention and model allowlist), so the build should record `cost` and not assume it is the whole bill.
- **Default interpreter model id: `typesafe-ai/jev`.** It was the more accurate and the faster. `openai/gpt-6-luna-decisions` is the fallback and works through the same endpoint with the same request, so it is a model id in settings. `typesafe-ai/jev-1.14.0` is the pinned version if the unpinned id moves.
- **Escalation threshold.** Jev's one wrong answer below 0.6 confidence was `escalate` for a plausible request (0.53), which is the safe direction; its other miss (`requestStatus` for "Which of my requests are still open?", 0.98) is a boundary between two commands that both read the sender's requests. Both models were only given the single message, so Luna's `addToRequest` misses (0.39 to 0.47) may improve once the open request is in the input; re-measure with context in Task 9.
- **Timeout.** p95 is 234 ms for Jev and 610 ms for Luna, well under 3 s, so the 3 s timeout stands.
- **Cost.** About $0.02 per 1,000 coworker messages on Jev.
- **Sample size.** The 30 phrasings are a small sample written by one person, so the 0.6 threshold remains a starting value to tune from real escalations.

## Open questions

- [ ] The threshold (0.6) and the append window (15 minutes): tune from escalations marked Not for me.
- [x] Whether Jev's latency suits a chat reply; Luna is the fallback (a setting). Yes: p95 234 ms (see Jev check results).
- [ ] Whether coworker-audience runs need a per-run cost cap below the global one.
