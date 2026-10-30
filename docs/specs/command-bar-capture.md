# Command Bar — Natural-language Capture

Oct 30, 2026 · Arek

## Summary

**Status: deferred.** This is built as a follow-up after [Core + Shell](core-and-shell.md). Core + Shell only ships the basic ⌘K bar (jump to items, run actions) and leaves the hooks this design needs. Part of the [Digital Life Hub overview](../overview.md).

Typing a sentence in the command bar, like `Review vendor contracts tomorrow 10am #q4`, turns it into a new item with its fields filled in. Three tiers do the reading, each slower and smarter than the last:

1. **Rules**, on every keystroke, on your machine. They extract the title, dates, times, `#project` and `!priority`.
2. **A decision model** (Luna or Jev, through OpenRouter), after you pause. It picks what rules can't: the item type, a project you didn't name, a priority.
3. **AI**, only when you ask, for sentences the first two can't handle.

Enter never waits for a slower tier. It saves what the chips show at that moment.

## How the tiers fit

*[Diagram: one capture · three tiers over time (not to scale)]*

Rules answer on every keystroke. The decision model answers once you pause. AI answers only when asked. Whatever is showing when you press Enter is what gets saved.

## Tier 1: rules

Rules run in the app on every keystroke, in under 5 ms, and work with no connection. They extract; they don't guess.

| Pattern | Example | Becomes |
| --- | --- | --- |
| Date and time (`chrono-node`) | tomorrow 10am, next Fri, in 3 days, Oct 30 | Due date chip |
| Time range | Fri 12–1 | Event type plus start and end |
| `#name` | #q4 | Project chip, fuzzy-matched against a cached list of project names |
| `!level` | !high, !1 | Priority chip |
| Everything left | Review vendor contracts | Title |

**Chip behaviour**

- Recognised words are highlighted in the input as you type.
- Backspacing into a chip turns it back into plain words, so a wrong guess is one keystroke to undo.
- When `#` matches several projects, a small list opens under the cursor, like an @-mention.
- Each capture parser is registered by its module (Tasks, Events, Notes) through the `CaptureParser` interface in the Core spec.

**Correction log.** When you change a chip after capture (a different project, a date moved), the app records the original text, what each tier proposed and what you kept. It stays in your database and serves as the test set for tuning tiers 1 and 2.

## Tier 2: decision model

A decision model picks from answers we supply and returns a confidence for each. It doesn't write text, so it can't invent a field. Both candidates are reachable through OpenRouter, which the AI gateway already uses, so either one is a model id in settings, not new integration code.

| Model | Maker | Status | Claimed speed |
| --- | --- | --- | --- |
| [Luna Decisions](https://openrouter.ai/openai/gpt-6-luna-decisions) | OpenAI | Released Oct 6, 2026 | About 150 ms |
| [Jev](https://yourstory.com/ai-story/what-is-jev-typesafe-ai-decision-model) | TypeSafe AI | Early access since Sep 15, 2026 | Single pass, no published figure |

Neither speed claim is independently measured yet, and published prices disagree. Start with one, then compare both on the correction log.

**Questions asked in one request**

| Question | Options supplied | Applied when |
| --- | --- | --- |
| What kind of item is this? | task, event, note | Confidence ≥ 0.8 and tier 1 found no time range |
| Which project does it belong to? | Your active project names, plus "none" | No `#` typed, confidence ≥ 0.8 |
| What priority? | none, low, high | Confidence ≥ 0.9 and no `!` typed |

- Tier 1's chips always win. The model only fills gaps, never overrides what you typed.
- The request goes from the app to your server, which adds the OpenRouter key and forwards it. Keys stay off your devices.
- Thresholds start as above and get tuned from the correction log.

**Privacy.** The text you've typed so far, and your project names, go to OpenRouter and the model's maker each time you pause. A setting turns tier 2 off; tiers 1 and 3 still work.

## Tier 3: AI on request

For sentences the first two tiers can't handle, like "remind me to call Mum after the dentist". It never runs on its own.

- A "✦ Interpret with AI" row appears when tier 1 leaves words it couldn't place, or you press Tab at any time.
- The request goes through the AI gateway, so it uses your chosen provider: OpenRouter, or the Claude Code or Codex CLI on your subscription.
- The answer must match the same chip schema as the other tiers. It replaces the chips; you confirm with Enter as usual.

## Timing and Enter

1. Tier 2 starts 300 ms after the last keystroke. Typing again cancels a request in flight.
2. A tier 2 answer is applied only if the text hasn't changed since it was sent. Chips it adds flash once, so you see what changed.
3. Enter saves the chips showing right now. If tier 2 is still running, you get tier 1's reading; nothing waits.
4. If tier 2 takes over 1 second or fails, it is dropped silently. Tier 1 stays.
5. Tier 3 shows a spinner on its row and keeps the bar open until it answers or you press Esc.

## What Core + Shell must leave room for

None of this is built in the first pass. Core + Shell only needs these hooks so the follow-up plugs in without rework:

- [ ] `CaptureParser` in the module contract, even if no module registers one yet
- [ ] A chip model in the command bar (type, title, fields) that any tier can fill
- [ ] AI gateway support for an OpenRouter model id per job, so a decision model is a setting
- [ ] A `capture_corrections` table reserved in the schema (can stay empty)

## Open questions

- [ ] Luna or Jev first? Decide once both are out of preview and real latency can be measured from your machines.
- [ ] Enter when the text could be a search or a new item ("vendor contracts"): open the best match, or create?
- [ ] Repeating tasks ("every Monday") need a recurrence field the data model doesn't have yet. Belongs to the Tasks deep dive.
- [ ] When `#name` matches no project: offer to create it, or leave it as text?

## Sources

- [The New Stack: OpenAI Decision API (Luna)](https://thenewstack.io/openai-decision-api-luna/)
- [OpenRouter: GPT-6 Luna Decisions](https://openrouter.ai/openai/gpt-6-luna-decisions)
- [OrcaRouter: OpenAI Decisions API](https://www.orcarouter.ai/blog/openai-decisions-api-gpt-6-luna)
- [YourStory: Introducing Jev](https://yourstory.com/ai-story/what-is-jev-typesafe-ai-decision-model)
- [Thoughtworks: Jev decision models](https://www.thoughtworks.com/insights/blog/generative-ai/jev-decision-models-what-need-know-why)
- [DataNorth: Jev](https://datanorth.ai/blog/jev-what-it-is-and-why-this-new-model-matters)
