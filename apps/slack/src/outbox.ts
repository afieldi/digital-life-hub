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

/** The code of a Slack platform error (`channel_not_found`, …): the row can't be posted as it is. A rate limit is not one. */
function platformError(e: unknown): string | null {
  const code = (e as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof code === "string" && code && code !== "ratelimited"
    ? code
    : null;
}

const describe = (e: unknown) => (e as Error | null)?.message || String(e);

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

  /**
   * Posts one row and records the outcome. "stop" when the rest of the batch
   * should wait for the next tick: Slack failed in a way that may pass (the row
   * stays approved), or the hub could not be told.
   */
  async function send(row: PendingSend): Promise<"done" | "stop"> {
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
      const code = platformError(e);
      if (!code) {
        log(`outbox ${row.id}: not posted, retrying next tick: ${describe(e)}`);
        return "stop";
      }
      error = code;
    }
    try {
      // The post is done: repeat the mark rather than the post, so it goes out once.
      if (ts) await retry(() => api.markSent({ id: row.id, ts: ts as string }));
      else
        await retry(() =>
          api.markFailed({ id: row.id, error: error as string }),
        );
      log(`outbox ${row.id}: ${ts ? "sent" : `failed (${error})`}`);
      return "done";
    } catch (e) {
      log(`outbox ${row.id}: could not record the outcome: ${describe(e)}`);
      return "stop";
    }
  }

  /** One pass. Returns whether another is due at once: a full batch, all recorded. */
  async function once(): Promise<boolean> {
    try {
      await api.syncRuns();
      const rows = await api.pendingSends();
      for (const row of rows) {
        if ((await send(row)) === "stop") return false;
      }
      return rows.length >= BATCH;
    } catch (e) {
      log(`outbox tick failed: ${describe(e)}`);
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
