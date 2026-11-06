import type { BotSettings, Turn } from "./api";
import type { SlackMessageEvent } from "./classify";

type Message = {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
};
type Page = { messages?: Message[] };

/** The slice of Slack's Web API this service uses; Bolt's `WebClient` fits it. */
export type SlackWeb = {
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<unknown>;
    getPermalink(args: {
      channel: string;
      message_ts: string;
    }): Promise<{ permalink?: string }>;
  };
  conversations: {
    history(args: {
      channel: string;
      latest: string;
      inclusive: false;
      limit: number;
    }): Promise<Page>;
    replies(args: {
      channel: string;
      ts: string;
      latest: string;
      inclusive: false;
      limit: number;
    }): Promise<Page>;
  };
  reactions: {
    add(args: {
      channel: string;
      timestamp: string;
      name: string;
    }): Promise<unknown>;
  };
  users: {
    profile: {
      get(args: { user: string; include_labels: true }): Promise<{
        profile?: {
          real_name?: string;
          display_name?: string;
          fields?: Record<string, { value?: string; label?: string }> | null;
        };
      }>;
    };
  };
};

/** The most earlier messages sent with a message. */
export const CONTEXT_LIMIT = 10;

/**
 * The last 10 messages before `event`, oldest first: the thread's when it is
 * in one, else the channel's (a DM's) history.
 */
export async function fetchContext(
  web: SlackWeb,
  event: SlackMessageEvent,
  settings: Pick<BotSettings, "ownerSlackId" | "botUserId">,
): Promise<Turn[]> {
  const base = { channel: event.channel, latest: event.ts, inclusive: false };
  const messages = event.thread_ts
    ? ((
        await web.conversations.replies({
          ...base,
          ts: event.thread_ts,
          limit: 200,
        } as Parameters<SlackWeb["conversations"]["replies"]>[0])
      ).messages ?? [])
    : // History comes newest first.
      [
        ...((
          await web.conversations.history({
            ...base,
            limit: CONTEXT_LIMIT + 1,
          } as Parameters<SlackWeb["conversations"]["history"]>[0])
        ).messages ?? []),
      ].reverse();
  return messages
    .filter((m) => m.ts !== event.ts && typeof m.text === "string")
    .slice(-CONTEXT_LIMIT)
    .map((m) => ({
      from:
        m.bot_id || (m.user && m.user === settings.botUserId)
          ? "bot"
          : m.user && m.user === settings.ownerSlackId
            ? "owner"
            : "sender",
      text: m.text ?? "",
    }));
}
