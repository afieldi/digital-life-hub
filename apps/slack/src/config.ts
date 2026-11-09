import { z } from "zod";

const config = z.object({
  /** Opens the Socket Mode connection (`xapp-…`). */
  appToken: z.string().min(1),
  /** Posts and reads as the bot (`xoxb-…`). */
  botToken: z.string().min(1),
  apiUrl: z.url(),
  /** What the hub knows this service by: the slack service token. */
  hubToken: z.string().min(1),
});
export type Config = z.output<typeof config>;

const names: Record<keyof Config, string> = {
  appToken: "SLACK_APP_TOKEN",
  botToken: "SLACK_BOT_TOKEN",
  apiUrl: "HUB_API_URL",
  hubToken: "HUB_SLACK_TOKEN",
};

/** Reads the service's settings from `env`; throws a message naming each bad variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = config.safeParse({
    appToken: env[names.appToken],
    botToken: env[names.botToken],
    apiUrl: env[names.apiUrl],
    hubToken: env[names.hubToken],
  });
  if (parsed.success) return parsed.data;
  const bad = [
    ...new Set(
      parsed.error.issues.map((i) => names[i.path[0] as keyof Config]),
    ),
  ];
  throw new Error(
    `Invalid Slack service config: ${bad.join(", ")} missing or invalid`,
  );
}
