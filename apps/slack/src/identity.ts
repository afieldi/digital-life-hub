import type { BotSettings } from "./api";
import type { SlackWeb } from "./context";

/**
 * The settings with Slack's own word for the workspace and the bot: `auth.test`
 * names both, so a default install ignores other workspaces' Slack Connect
 * users without anyone typing the ids. Its answer wins over the hub's; when
 * Slack can't be asked, the last answer stands, else the hub's values.
 * Wrap the cached settings read, so Slack is asked when they refresh.
 */
export function withIdentity(
  read: () => Promise<BotSettings>,
  web: Pick<SlackWeb, "auth">,
  log?: (line: string) => void,
): () => Promise<BotSettings> {
  let known: { team_id?: string; user_id?: string } = {};
  return async () => {
    const settings = await read();
    try {
      known = await web.auth.test();
    } catch {
      log?.("auth.test failed; using the last known team and bot ids");
    }
    return {
      ...settings,
      teamId: known.team_id || settings.teamId,
      botUserId: known.user_id || settings.botUserId,
    };
  };
}
