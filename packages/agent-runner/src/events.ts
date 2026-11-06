import type { EventBatch, Host } from "./host";

type Event = EventBatch[number];

/** The run's live log, sent to the worker in order; the worker numbers it. */
export interface EventSink {
  add(kind: Event["kind"], data: Event["data"]): void;
  /** Resolves once everything added so far was sent (or failed to). */
  drain(): Promise<void>;
}

/**
 * Sends events one batch at a time. A failed send is dropped with a log
 * line: the log is for watching, and the worker may already be gone.
 */
export function createEventSink(
  host: Pick<Host, "events">,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
): EventSink {
  const held: Event[] = [];
  let chain: Promise<void> = Promise.resolve();

  const send = async () => {
    const batch = held.splice(0);
    if (batch.length === 0) return;
    try {
      await host.events(batch);
    } catch (e) {
      log(`events: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    add(kind, data) {
      held.push({ at: now().toISOString(), kind, data });
      chain = chain.then(send);
    },
    drain: () => chain,
  };
}
