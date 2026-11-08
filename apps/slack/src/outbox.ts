import type { HubApi, PendingSend } from "./api";
import type { SlackWeb } from "./context";
import { type EventDeps, withRetries } from "./events";

export type OutboxDeps = {
  api: HubApi;
  /** The bot's Web client: every row is posted as the bot. */
  bot: SlackWeb;
  /** Row ids and outcomes only, never message text. */
  log?: (line: string) => void;
  /** Waits between retries of a mark; for tests. */
  sleep?: (ms: number) => Promise<void>;
};

/** How many rows one `pendingSends` hands over at most. */
const BATCH = 20;

/** Slack's error code (`channel_not_found`, …), else the error's message. */
function errorCode(e: unknown): string {
  const code = (e as { data?: { error?: unknown } } | null)?.data?.error;
  if (typeof code === "string" && code) return code;
  return (e as Error | null)?.message || "unknown_error";
}

/**
 * Posts what the hub has approved. A tick queues the reports of ended runs,
 * then posts each approved row and says so to the hub. Ticks never overlap;
 * one asked for while another runs runs once after it.
 */
export function createOutbox(deps: OutboxDeps): { tick(): Promise<void> } {
  const { api, bot } = deps;
  const log = deps.log ?? (() => {});
  const retry = <T>(fn: () => Promise<T>) =>
    withRetries({ sleep: deps.sleep } as unknown as EventDeps, fn);

  /** Posts one row and records the outcome; false when the hub could not be told. */
  async function send(row: PendingSend): Promise<boolean> {
    let ts: string | undefined;
    let error: string | undefined;
    try {
      ts = (
        await bot.chat.postMessage({
          channel: row.channelId,
          text: row.text,
          thread_ts: row.threadTs ?? undefined,
        })
      ).ts;
      if (!ts) error = "Slack gave no timestamp";
    } catch (e) {
      error = errorCode(e);
    }
    try {
      // The post is done: repeat the mark rather than the post, so it goes out once.
      if (ts) await retry(() => api.markSent({ id: row.id, ts: ts as string }));
      else
        await retry(() =>
          api.markFailed({ id: row.id, error: error as string }),
        );
      log(`outbox ${row.id}: ${ts ? "sent" : `failed (${error})`}`);
      return true;
    } catch (e) {
      log(`outbox ${row.id}: could not record the outcome: ${errorCode(e)}`);
      return false;
    }
  }

  /** One pass. Returns whether another is due at once: a full batch, all recorded. */
  async function once(): Promise<boolean> {
    try {
      await api.syncRuns();
      const rows = await api.pendingSends();
      let recorded = true;
      for (const row of rows) {
        if (!(await send(row))) recorded = false;
      }
      return recorded && rows.length >= BATCH;
    } catch (e) {
      log(`outbox tick failed: ${errorCode(e)}`);
      return false;
    }
  }

  let current: Promise<void> | null = null;
  let again = false;

  async function loop() {
    do {
      again = false;
      if (await once()) again = true;
    } while (again);
  }

  return {
    tick() {
      if (current) again = true;
      else
        current = loop().finally(() => {
          current = null;
        });
      return current;
    },
  };
}
