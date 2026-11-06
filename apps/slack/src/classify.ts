import type { BotSettings } from "./api";

/** A Slack message event, as far as this service reads it. */
export type SlackMessageEvent = {
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  team?: string;
  user_team?: string;
  channel_type?: string;
};

/** Who is speaking: nobody to answer, the owner, or a coworker. */
export function classify(
  event: SlackMessageEvent,
  settings: BotSettings,
): "ignore" | "owner" | "coworker" {
  if (event.bot_id || event.subtype || !event.user) return "ignore";
  if (event.user === settings.botUserId) return "ignore";
  const team = settings.teamId;
  if (team && [event.team, event.user_team].some((t) => t && t !== team)) {
    return "ignore";
  }
  return event.user === settings.ownerSlackId ? "owner" : "coworker";
}
