import { App, LogLevel } from "@slack/bolt";
import { createApi } from "./api";
import type { SlackMessageEvent } from "./classify";
import { loadConfig } from "./config";
import type { SlackWeb } from "./context";
import { serialByUser } from "./events";
import { withIdentity } from "./identity";

/** How long the owner, team and bot ids are kept before the hub is asked again. */
const SETTINGS_TTL_MS = 30_000;

const config = loadConfig(process.env);
const api = createApi(config);
const app = new App({
  token: config.botToken,
  appToken: config.appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

const web = app.client as unknown as SlackWeb;
// The hub's settings, with the team and bot ids from Slack's `auth.test`.
const readSettings = withIdentity(api.botSettings, web, (line) =>
  console.warn(line),
);

let cached: { at: number; value: ReturnType<typeof readSettings> } | null =
  null;
const settings = () => {
  if (!cached || Date.now() - cached.at > SETTINGS_TTL_MS) {
    const value = readSettings();
    cached = { at: Date.now(), value };
    // A failed read is not kept.
    value.catch(() => {
      if (cached?.value === value) cached = null;
    });
  }
  return (cached as NonNullable<typeof cached>).value;
};

const handle = serialByUser({
  web,
  api,
  settings,
  log: (line) => console.log(line),
});

/** Handles in the background: the listener returns at once, so Bolt acknowledges the event. */
const accept = (event: SlackMessageEvent) => {
  void handle(event);
};

app.message(async ({ message }) => {
  const event = message as unknown as SlackMessageEvent;
  if (event.channel_type === "im") accept(event);
});
app.event("app_mention", async ({ event }) => {
  accept(event as unknown as SlackMessageEvent);
});

await app.start();
try {
  const ready = await settings();
  console.log(`Slack bot ready, bot user ${ready.botUserId ?? "unknown"}`);
} catch {
  // Each event reads the settings again, so the service carries on.
  console.warn("Slack bot started, but the hub could not be reached yet");
}
