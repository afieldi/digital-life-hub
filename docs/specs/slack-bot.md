# Slack Bot — Deep-dive Spec

Nov 6, 2026 · Arek · Draft

## Scope

Talk to the hub from Slack, and let coworkers reach you through it. You DM the bot to ask about your tasks and queue, capture things, draft replies and hand work to the agent. Coworkers DM or @mention it to leave you requests, ask what involves them and ask for reviews; it answers them on its own from what involves them, and escalates to your queue when it isn't sure. It also lays the shared Slack base (one Slack app, one always-on service) that Slack intake and notifications reuse later. Part of the [Digital Life Hub overview](../overview.md); builds on the [Queue](requests.md), the [AI gateway](ai-gateway.md) and the [Agent hub](agent-hub.md).

**In scope**

- The Slack app (Socket Mode) in your work workspace: a bot token, an app token and a user token for you
- `apps/slack`: a thin always-on service that receives Slack events, calls the API, and posts what it returns
- `modules/slack`: settings, the people map, the outbox, its operations, Settings → Slack and a detail panel
- A model interpreter (Jev, through Vercel AI Gateway) that picks the action, kind and subject for a message
- Escalation: anything the interpreter isn't sure of goes to your queue with its candidates as buttons
- Your side: ask, capture, Undo, drafts sent as you after Send, handing work to the agent
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

**Done when**

1. From your phone, "remind me to chase Dana Friday" makes a task, and Undo in Slack removes it.
2. A coworker's three quick DMs become one request holding all three, and they get one acknowledgement.
3. "Did Arek see my request?" gets the right status, and "never mind" withdraws it.
4. "@ArekBot how many open PRs does Arek have for me?" is answered correctly, with nothing in the answer that doesn't involve the asker.
5. An ambiguous message, yours or a coworker's, lands in the queue as "Bot wasn't sure"; running a suggested action there completes it and replies in Slack.
6. A draft reply goes out under your name only after you press Send.
7. "Have the agent do X" in your DM starts a run with no further confirm, and its report comes back to that DM.
8. A coworker's request handed to the agent runs with coworker audience: it can reply in their DM on its own, and asking to read anything else of yours files an approval.
9. Restarting `apps/slack` loses no coworker message, approved draft or agent post.

## Decisions

| Topic | Decision |
| --- | --- |
| Shape | A thin `apps/slack` service plus `modules/slack` in the API, like `apps/agent` and `modules/agent`. The service holds the Slack tokens and no AI and no database |
| Transport | Socket Mode. No public URL |
| Workspace | Your work workspace. Bot token, app token, and a user token for you with `chat:write` only |
| AI for the bot | The light gateway, already in the API. `modules/slack` calls its code directly, as you; `apps/slack` never calls `ai.*` |
| Interpreting | A model interpreter on Jev through Vercel AI Gateway. Jev picks; it writes no text. The gateway's generative model fills inputs and writes answers |
| Unsure | Below the threshold (0.6), or no match: escalate to your queue with the candidates as action buttons. Never a guess, never a "Did you mean" in Slack |
| Coworkers | Interpreted too, against a small coworker command set. The bot answers them on its own, as the bot |
| What a coworker can learn | Only what involves them: their requests, and asker-scoped lookups (`audience: "asker"`). Bounded by what the model can see, not by reviewing what it writes |
| Several messages | File the first at once, then append later ones from the same sender in the same DM or thread within 15 minutes while the request is open |
| Posting as you | Only a draft you sent. Never the bot, never the agent alone |
| Handing off | Your "have the agent do X" is the approval. It runs at once, with Undo until claimed and Cancel after |
| Agent replies to coworkers | Free, as the bot, to the thread the request came from, because a coworker-audience run can only read what involves them. Anything wider is an approval of the action, not of the message |
| Posting from elsewhere | Everything not a direct reply goes through `slack_outbox`; `apps/slack` sends it. No other process holds a Slack token for this |
| GitHub writes | Capped at Suggest (confirmed before running), so they need no external Undo |
| History | Slack keeps the conversation. The hub stores no chat turns; the gateway's request log records every AI request |

## Packages

```
apps/slack          NEW: Bolt app in Socket Mode, the slack-token API client, the outbox sender
modules/slack       NEW: slack_settings, slack_people, slack_outbox; operations; Settings → Slack; request detail panel
modules/requests    + requests.append, requests.fromSender, appended_ids
modules/agent       + run audience, coworker connection set, agent.recentRuns, hub-call approvals
packages/core       + access "slack", audience "asker", the model interpreter's contract (subjects)
packages/server     + slack principal, runAsOwner, the model interpreter, the Vercel AI Gateway provider (prerequisite)
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
| Yours (`xoxp-`) | `chat:write` | Posting a draft you sent. Nothing else |

Events: `message.im` and `app_mention`. The bot reads a channel thread only when it is mentioned in it, for context. It subscribes to no channel messages.

Config, in `apps/slack`'s environment: `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_USER_TOKEN`, `HUB_API_URL`, `HUB_SLACK_TOKEN`. The API needs no Slack secret.

## Who is speaking

`apps/slack` classifies every event before it calls the API:

1. A bot message (`bot_id` set), its own post, an edit, a delete or any other `subtype`: ignored.
2. A user from another team (Slack Connect): ignored.
3. `user` equals `slack_settings.owner_slack_id`: **you**.
4. Anyone else in the workspace: a **coworker**.

Socket Mode is an authenticated connection, so the sender's user id is trusted as sent. The API trusts what `apps/slack` says about the sender because only `apps/slack` holds a slack token.

**Context.** With each message `apps/slack` sends the last 10 messages before it: the DM's history (`conversations.history`), or the thread's (`conversations.replies`) when the message is in a thread. Each carries who sent it (you, the bot, the coworker) and, for the bot's messages, the `ai_request_id` from the message's Slack `metadata`.

## Interpreting messages

The gateway's interpreter contract (`RequestInterpreter`) gets a second implementation, `model:<id>`, configured to Jev. Jev is a decision model: it is given options and returns a pick with a confidence, and writes no text. It runs on the server, through Vercel AI Gateway.

**What it picks.** One request to Jev answers three questions:

| Question | Options supplied |
| --- | --- |
| Which action? | The sender's command set (below), each as `id` + `description`, plus `escalate` |
| Which kind? | The kinds that action allows |
| Which subject? | For actions that apply to an item: up to 5 candidates from full-text search on the message, plus "none" |

`Interpretation` gains `subjectId: string | null`. Below `slack_settings.threshold` (0.6) on the action, or a pick of `escalate`, the message escalates. The server re-checks the action, the subject's type and the cap as it does for ⌘K; safety never depends on Jev.

**Command sets**

| You | Coworkers |
| --- | --- |
| Every AI action the gateway has (Core's and modules', so `tasks.create`, `answer`, `requests.makeTask`…) | `leaveRequest`: file a request (the default) |
| `slack.handOff`: give the message's work to the agent | `addToRequest`: append to their open request (see Several messages) |
| `slack.draftReply`: draft a reply as you to a Slack request | `requestStatus`: their requests, open or resolved, and when |
| | `withdraw`: resolve their open request as `handled` |
| | `askAbout`: answer from an asker-scoped lookup (`github.prsBetween`, their requests) |
| | `requestReview`: ask you to review their PR |
| | `requestAgentReview`: ask for an AI review of their PR (always escalates) |
| | `escalate`: something only you can answer |

**Running.** Once picked, the gateway runs the action as it does for ⌘K: the generative model fills the input and writes any answer, the output is checked, and a Do applies with Undo. `modules/slack` reaches the gateway through `runAsOwner` (see Core changes), as you.

**Coworker answers.** `askAbout` and `requestStatus` reply in words written by the model, as the bot. Their prompt is built by one fixed context builder that holds only the conversation with that coworker and the result of the lookup Jev picked. It gets no item search, no tools and no other context, so a prompt like "summarise Arek's tasks" has nothing to draw on. The rest of the coworker set replies with fixed templates.

**Rules only.** `slack_settings.coworker_ai` off sends no coworker text to Jev: every coworker message is `leaveRequest` or `addToRequest` by the time rule. If Jev fails or times out (3 s), the message is handled the same way.

## Escalation

An escalated message files a request, through `requests.file` called by `slack.handleMessage`, so it may carry actions:

- `source: "slack"`, `externalId` `<channel>:<ts>`, `sourceUrl` the message's permalink, `fromName` and `sourceHandle` the sender's
- Title "Bot wasn't sure: \<first line\>", body the message
- Up to 2 actions from Jev's top candidates in the **sender's** command set, each labelled with what it does, e.g. "Create task: Chase Dana · Fri" or "Reply to Dana: PR status". Each runs `slack.runEscalated({ requestId, actionId, kind, subjectId })`, which runs the action as you, resolves the request as `handled`, and puts the reply into the outbox for the source thread
- A third action, Neither, runs `slack.dismissEscalation`: it resolves the request as `not_for_me`, kept for tuning the threshold. Actions replace the three outcomes on screen (Queue spec), so this stands in for them

In Slack, you get "Not sure what you meant, so I put it in your queue" with a link. A coworker gets the normal acknowledgement and never sees the bot's uncertainty.

## Message flows

**You (DM, or @mention in a thread)**

1. `slack.handleMessage` interprets and runs.
2. The reply depends on the kind: Ask, the answer; Suggest, the options as buttons; Do, "Done: …" with Undo. Every reply carries its `ai_request_id` in the message's metadata and buttons.
3. A button calls `slack.handleAction`: apply an option, or undo, as you.

**Coworkers (DM, or @mention)**

1. `slack.handleMessage` interprets against the coworker set.
2. `leaveRequest` files a request and replies with `slack_settings.ack_text` ("Got it, I've passed this to Arek."). `addToRequest` appends and reacts with 👀.
3. `requestStatus`, `askAbout` and `withdraw` answer from their own requests or an asker lookup.

**Several messages.** A coworker's message is `addToRequest` when they have an open request filed from the same DM or thread less than `slack_settings.append_minutes` (15) ago. The rule reads `source_handle`, the channel in `external_id`, and `received_at` through `requests.fromSender`. Jev still chooses between appending and a new request when both apply.

**Drafts (replying as you)**

1. "Reply to Dana: yes, Friday works" in your DM, or "Draft a reply" in the detail panel of a Slack request, runs `slack.draftReply` (Do): the model writes the draft, which goes into `slack_outbox` as `pending`, `as: "me"`, and a request "Reply to Dana" is filed with the actions Send and Discard.
2. The draft's text is editable in the request's detail panel while `pending`.
3. Send runs `slack.sendDraft`: the outbox row becomes `approved` and the request is resolved as `handled`. Undo works until it is sent.
4. `apps/slack` posts it with your user token and calls `slack.markSent`. An `approved` draft can't be edited.

**Handing off to the agent**

1. "Have the agent do X" in your DM: Jev picks `slack.handOff`.
2. `handOff` files a request for the message (`source: "slack"`, `sourceUrl` your DM's permalink), then runs `agent.assignRequest` on it as you, top level, through `runAsOwner`. It is not an operation call, because `assignRequest` makes calls of its own.
3. Reply: "Given to the agent: \<task\>" with Undo (until the worker claims the run) and Cancel run.
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

**Running as you from module code.** `runAsOwner(deps, fn)`, exported from `@dlh/server` for module server code, runs gateway steps (interpret, prepare, complete, apply an option, undo) and top-level operations as you, with your writer, Undo tokens and request log, exactly as the desktop app's calls would. It is the only way a non-user principal reaches the gateway or `ops.undo`. It checks that the calling procedure's principal is `slack`. Requests it starts are logged with a new `ai_requests.origin` column (`app` by default, `slack` here), and `slack.handleAction`'s undo and apply refuse any AI request whose origin isn't `slack`.

**Model interpreter.** `interpreterId` gains `model:<id>`. The server runs it; the desktop keeps the keyword interpreter for ⌘K unless Settings → AI picks the model. `Interpretation` gains `subjectId`. The phrasing suite runs against it, at the same 90% bar.

**Asker audience.** `OperationDescription.audience?: "asker"` marks an operation whose output is only what involves one person. It runs with `ctx.asker: { slackUserId, githubLogin }` and must filter on it; the coworker context builder and coworker-audience runs may call only these. A test asserts each one returns nothing for an unrelated asker.

**Vercel AI Gateway provider** (prerequisite, the separate change the overview already plans). Jev and the gateway's generative model both go through it on the server.

## Queue changes

- `requests.appended_ids` text[], default `{}`.
- `requests.append({ id, key, text, at })`: adds a blank line and the text to the body, records `key` (the message's `<channel>:<ts>`) in `appended_ids`, bumps the version. A key already in `appended_ids` changes nothing. A resolved request is `CONFLICT` "Already resolved". `palette: false`, `ai: false`; called by `slack.handleMessage`.
- `requests.fromSender({ openOnly? })`: a query, `audience: "asker"`, the Slack requests whose `source_handle` is `ctx.asker.slackUserId`, with their status and resolved time. The sender comes from the context, never the input.

## Agent hub changes

These change the [Agent hub spec](agent-hub.md); it links here.

**Run audience.** `agent_runs.audience` jsonb, null for you, `{ asker: { slackUserId, githubLogin } }` for a run whose request was filed by a coworker (`source: "slack"` and `source_handle` not yours). `assignRequest` sets it from the request; `claim` passes it to the runner.

A coworker-audience run, alone:

| May | Only |
| --- | --- |
| Read the hub | `audience: "asker"` operations, and its own task and request |
| Write the hub | Its own task, filing requests for you, `slack.postToSource` |
| Use connections | `agent_settings.coworker_connection_ids`, chosen in Settings → Agent (default: none) |

Any other hub call is ask: the run suspends with an approval quoting the call ("Read your note 'Reorg plan'"), as for any ask. Approve records `{ operation, inputHash }` on the run (`agent_runs.hub_approvals`), and the API accepts that one call once from the run's token. The API refuses (`FORBIDDEN`) any other out-of-audience call from a coworker-audience run's token; the runner's hook is the guide, the API the limit. Grants work as today, from the whole connection list.

**Posting to Slack.** `slack.postToSource({ text })`, callable by a run token, posts as the bot to the thread or DM the run's request came from. It reads the request through the run, refuses a request not from Slack, and puts the post in `slack_outbox` as `approved`. At most 5 posts per run and 2,000 characters each. It is the agent's only way to post into a DM with the bot; its own `slack` connection keeps posting in channels under the existing rule.

**Posting as you.** The alone/ask table's "Slack messages, as the bot or as you, to the people and threads the task came from" becomes "as the bot". A run never posts as you.

**Reports.** `agent.recentRuns({ since })`, a query callable through operation calls, lists runs that ended after `since` with their task and request ids. `slack.syncRuns` uses it.

**Prompt.** A coworker-audience run's prompt says that the coworker reads what it posts, and which reads need approval.

## Data model

`modules/slack`. Foreign keys to `items` cascade.

| Table | Columns | Notes |
| --- | --- | --- |
| `slack_settings` | One row: `team_id`, `bot_user_id`, `owner_slack_id`, `ack_text`, `threshold` (0.6), `append_minutes` (15), `interpreter` (`model:jev`), `coworker_ai` (true), `runs_synced_at` | Set in Settings → Slack. `owner_slack_id` is required before the bot answers anyone; until then it replies "Not set up yet" |
| `slack_people` | `slack_user_id` (key), `name`, `github_login` null, `github_from` (`profile` or `manual`), `updated_at` | Filled from the Slack profile's GitHub field on first contact, or set by you. A manual login is never overwritten |
| `slack_outbox` | `id`, `key` unique, `origin` (`draft`, `agent`, `report`, `review_ping`, `escalation`), `as` (`bot` or `me`), `channel_id`, `thread_ts` null, `text`, `status` (`pending`, `approved`, `sent`, `failed`, `discarded`), `request_id` FK `items` null, `run_id` null, `error` null, `sent_ts` null, `created_at`, `approved_at`, `sent_at` | `as: "me"` only for `origin: "draft"` (a check). `key` makes every insert idempotent: `report:<runId>`, `agent:<runId>:<n>`, `draft:<requestId>`… |

The hub keeps no copy of Slack conversations.

## Operations (Slack)

| Operation | Access | Does |
| --- | --- | --- |
| `handleMessage({ event, sender, context })` | slack | The entry point for every message. Returns `{ reply?, react? }` for `apps/slack` to post |
| `handleAction({ action, aiRequestId, option? })` | slack | A Slack button: apply an option, undo, cancel a run |
| `pendingSends()` | slack | `approved` outbox rows |
| `markSent({ id, ts })` / `markFailed({ id, error })` | slack | Outbox results. A failed draft goes back to `pending` with the error shown |
| `syncRuns()` | slack | For runs ended since `runs_synced_at` whose request came from your DM, adds a `report` row to the outbox |
| `handOff`, `draftReply` | user (AI) | Your commands, run through the gateway as you. `user`, so a run can't hand work to the agent or draft as you |
| `sendDraft({ id, expectedUpdatedAt })` / `discardDraft` | user | Request actions on a draft. Send approves; Undo before it is sent |
| `runEscalated({ requestId, actionId, kind, subjectId })` / `dismissEscalation({ requestId })` | user | Request actions on an escalation |
| `decline({ requestId })` | user | Request action on a coworker's AI-review request |
| `postToSource({ text })` | everyone, run tokens only | See Agent hub changes |
| `settings`, `setSettings`, `people`, `setGithubLogin` | user | Settings → Slack |

## apps/slack

- **Events.** Bolt in Socket Mode. Every event is acknowledged at once, then handled: classify the sender, fetch the context, call `slack.handleMessage`, post the reply in the same thread (a DM reply is threaded only if the message was).
- **Outbox.** Listens on `/changes`; on a change, and every 30 seconds, it calls `slack.syncRuns`, then sends `pendingSends()` in order, with the bot or your user token by `as`, and reports each with `markSent` or `markFailed`. A review ping opens the DM with `conversations.open`.
- **Restart.** Socket Mode redelivers unacknowledged events. On start the outbox loop runs at once, so approved drafts and agent posts sent while it was down go out.
- **Nothing stored.** No database, no AI key. Its only secrets are the three Slack tokens and its slack token.
- **Compose.** One more service in `deploy/vps`, on the compose network with the API.

## Screens

- **Settings → Slack.** Connection status (when `apps/slack` last called), your Slack user, the acknowledgement text, the threshold, the append window, "Coworker messages use AI" and the people list with GitHub logins.
- **Settings → Agent** gains the coworker connection set.
- **Request detail panel** (registered for `request`, shown when `source` is `slack`): the Slack thread link, the sender's GitHub login, and for a draft its editable text, status and any send error.
- **Queue rows.** "Bot wasn't sure" requests show their candidates as action buttons, like the agent's approvals.

## Errors

| Case | What happens |
| --- | --- |
| API unreachable | You: "Can't reach the hub right now." A coworker: filing is retried after 1, 4 and 15 seconds, then "Couldn't pass this on, please try again later." Never an acknowledgement for something not filed |
| A redelivered event | `requests.file` and `requests.append` are idempotent on `<channel>:<ts>` |
| Jev fails or times out | A coworker's message is filed or appended by rule; yours escalates |
| Interpreter unsure | Escalation |
| Undo after the item changed | The gateway's "Changed since" |
| Undo of a handoff after claim | "Changed since"; Cancel run is offered |
| A send fails (archived channel, revoked token) | The row is `failed`; a draft goes back to `pending` with the error in its panel |
| No GitHub login for a coworker | "I don't know your GitHub account yet", and the message escalates |
| A PR that isn't theirs (`requestReview`) | Escalates |
| A run posts a 6th time, or more than 2,000 characters | `BAD_REQUEST`; the run is told why |
| A coworker-audience run calls outside its audience | `FORBIDDEN` unless approved; the hook asks first |
| Not set up (`owner_slack_id` empty) | "Not set up yet" to everyone |

## Testing

- **Unit:** sender classification; the append rule; the reply blocks for Ask, Suggest, Do and escalation; the Slack permalink to `channel:ts` parsing, the same format `slackChannelOf` reads.
- **Interpreter:** the model interpreter runs the existing phrasing suites plus `modules/slack/test/ai-phrasings.ts` (your Slack phrasings) and `modules/slack/test/coworker-phrasings.ts`, at 90%. `pnpm ai:eval-interpreter --interpreter=model:jev` reports them.
- **Database (`test:db`):** `handleMessage` files once and appends once per message; `append` refuses a resolved request; a slack token is refused by every operation not marked `slack`, and by `ai.*` and `ops.undo`; `handleAction` refuses an AI request the bot didn't start; the coworker path never builds context with search; every `audience: "asker"` operation returns nothing for an unrelated asker; draft states, Send, Undo before sending; `handOff` runs `assignRequest` and its Undo; a coworker-audience run's token is refused out of audience and accepted once after approval; `postToSource` refuses a non-Slack request, a 6th post and a long one; outbox keys make `syncRuns` idempotent.
- **`apps/slack`:** a stub Slack Web API and socket against `testServer` with the scripted dev AI: events to replies, the outbox loop, restart catch-up, retries when the API is down.
- **Manual:** the Done when list, in the real workspace.

## Build order

1. Prerequisites: the Vercel AI Gateway provider (its own small change), and a throwaway Jev check: its latency and accuracy on the phrasing suites, through the Gateway.
2. Core: the slack principal and access, `/changes`, `runAsOwner`, `audience: "asker"`, the model interpreter.
3. Base and coworkers: the Slack app, `apps/slack`, `modules/slack` settings and people, `requests.append` and `fromSender`, the coworker command set, escalation, the compose service.
4. You: your command set, replies, Undo, escalation of your messages.
5. Outbox: drafts and Send, `handOff`, reports, and the Agent hub changes (run audience, `postToSource`, hub-call approvals).
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

- **Endpoint.** Decision models are not reachable through `/v1/chat/completions`, so a `response_format` schema doesn't apply. `createVercelGateway` calls `POST https://ai-gateway.vercel.sh/v1/decisions` with `{ model, input, questions: [{ type: "choice", name: "actionId", instructions, choices: [{ value, description }] }] }` and reads `answers[0].choice` and `answers[0].confidence`. A `choice` question is the enum: the answer is always one of the supplied values. Cost is `provider_metadata.gateway.cost`; usage is `usage.input_tokens`.
- **Default interpreter model id: `typesafe-ai/jev`.** It was the more accurate and the faster. `openai/gpt-6-luna-decisions` is the fallback and works through the same endpoint with the same request, so it is a model id in settings. `typesafe-ai/jev-1.14.0` is the pinned version if the unpinned id moves.
- **Escalation threshold.** Jev's one wrong answer below 0.6 confidence was `escalate` for a plausible request (0.53), which is the safe direction; its other miss (`requestStatus` for "Which of my requests are still open?", 0.98) is a boundary between two commands that both read the sender's requests. Both models were only given the single message, so Luna's `addToRequest` misses (0.39 to 0.47) may improve once the open request is in the input; re-measure with context in Task 9.
- **Timeout.** p95 is 234 ms for Jev and 610 ms for Luna, well under 3 s, so the 3 s timeout stands.
- **Cost.** About $0.02 per 1,000 coworker messages on Jev.

## Open questions

- [ ] The threshold (0.6) and the append window (15 minutes): tune from escalations marked Not for me.
- [ ] Whether Jev's latency suits a chat reply; Luna is the fallback (a setting).
- [ ] Whether coworker-audience runs need a per-run cost cap below the global one.
