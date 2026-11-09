import { type HubApi, isRetryable } from "./api";
import type { Button } from "./blocks";
import { blocksFor } from "./blocks";
import { classify, type SlackMessageEvent } from "./classify";
import { fetchContext, type SlackWeb } from "./context";
import { githubLogin } from "./profile";
import { plainText } from "./text";

/** How long to wait before each retry of a hub call that failed: 1, 4 and 15 s. */
export const RETRY_DELAYS_MS = [1000, 4000, 15000];

export const COWORKER_FAILED = "Couldn't pass this on, please try again later.";
export const OWNER_FAILED = "Can't reach the hub right now.";

type Person = { name: string; githubLogin: string | null };

export type EventDeps = {
  web: SlackWeb;
  api: HubApi;
  /** The owner, team and bot ids; the caller may cache them. */
  settings(): Promise<Awaited<ReturnType<HubApi["botSettings"]>>>;
  /** Event ids and outcomes only, never message text. */
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** People met by this process: their profile is read once. */
  people?: Map<string, Person>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calls `fn`, repeating it after 1, 4 and 15 s while the failure is the hub's. */
export async function withRetries<T>(
  deps: EventDeps,
  fn: () => Promise<T>,
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryable(e)) throw e;
      await sleep(delay);
    }
  }
}

/** The text without the bot's `<@…>` tag and the whitespace around it; with no known bot id, a leading tag. */
export function withoutBotTag(text: string, botUserId: string | null): string {
  const tag = botUserId
    ? new RegExp(`\\s*<@${botUserId}(\\|[^>]*)?>\\s*`, "g")
    : /^\s*<@U[A-Z0-9]+(\|[^>]*)?>\s*/;
  return text.replace(tag, " ").trim();
}

/** Where the answer goes: in the message's thread, but a top-level DM stays top level. */
function threadOf(event: SlackMessageEvent): string | undefined {
  if (event.thread_ts) return event.thread_ts;
  return event.channel_type === "im" ? undefined : event.ts;
}

/** Who they are, from Slack's profile once per process, recorded with the hub. */
async function knownPerson(
  deps: EventDeps,
  slackUserId: string,
): Promise<Person> {
  deps.people ??= new Map();
  const cache = deps.people;
  const cached = cache.get(slackUserId);
  if (cached) return cached;
  let person: Person = { name: slackUserId, githubLogin: null };
  let read = false;
  try {
    const { profile } = await deps.web.users.profile.get({
      user: slackUserId,
      include_labels: true,
    });
    person = {
      name: profile?.real_name || profile?.display_name || slackUserId,
      githubLogin: githubLogin(profile?.fields),
    };
    read = true;
  } catch {
    deps.log?.(`profile unreadable for ${slackUserId}`);
  }
  await deps.api.upsertPerson({ slackUserId, ...person });
  // An unreadable profile is asked for again with the next message.
  if (read) cache.set(slackUserId, person);
  return person;
}

/** Handles one Slack message event, start to finish; never throws for a failed hub. */
export async function handleEvent(
  deps: EventDeps,
  event: SlackMessageEvent,
): Promise<void> {
  const id = `${event.channel}:${event.ts}`;
  const { web, api } = deps;
  let kind: "owner" | "coworker" = "coworker";
  const post = (text: string, buttons?: Button[]) =>
    web.chat.postMessage({
      channel: event.channel,
      ...blocksFor(text, buttons),
      thread_ts: threadOf(event),
    });
  try {
    const settings = await withRetries(deps, () => deps.settings());
    const who = classify(event, settings);
    if (who === "ignore") return;
    kind = who;
    const sender = event.user as string;
    const [permalink, context] = await Promise.all([
      web.chat.getPermalink({ channel: event.channel, message_ts: event.ts }),
      fetchContext(web, event, settings, deps.log),
    ]);
    const link = permalink.permalink;
    if (!link) throw new Error("Slack gave no permalink");
    const result = await withRetries(deps, async () => {
      const person = await knownPerson(deps, sender);
      return api.handleMessage({
        event: {
          channel: event.channel,
          ts: event.ts,
          ...(event.thread_ts ? { threadTs: event.thread_ts } : {}),
          text: plainText(withoutBotTag(event.text ?? "", settings.botUserId)),
          permalink: link,
          isDm: event.channel_type === "im",
        },
        sender: {
          slackUserId: sender,
          name: person.name,
          githubLogin: person.githubLogin,
          isOwner: who === "owner",
        },
        context,
      });
    });
    if (result.reply) await post(result.reply, result.buttons);
    if (result.react) {
      await web.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: result.react,
      });
    }
    deps.log?.(`${id} handled`);
  } catch (e) {
    deps.log?.(`${id} failed: ${e instanceof Error ? e.name : "error"}`);
    try {
      await post(kind === "owner" ? OWNER_FAILED : COWORKER_FAILED);
    } catch {
      deps.log?.(`${id} apology not posted`);
    }
  }
}

/**
 * `handleEvent` that takes each sender's messages strictly in order, so two
 * quick messages never reach `handleMessage` together; other senders go on
 * at the same time.
 */
export function serialByUser(deps: EventDeps) {
  const tails = new Map<string, Promise<void>>();
  return (event: SlackMessageEvent): Promise<void> => {
    const key = event.user ?? event.bot_id ?? event.channel;
    const run = (tails.get(key) ?? Promise.resolve()).then(() =>
      handleEvent(deps, event),
    );
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
