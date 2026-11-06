import type { EventsRequest, MessagesResponse } from "@dlh/agent-protocol";

export type NumberedEvent = EventsRequest["events"][number] & { seq: number };

/** The API takes at most this many events per `appendEvents`. */
const MAX_PER_CALL = 200;

/**
 * Numbers a run's events after the claim's `lastSeq` and holds them until a
 * flush sends them. A failed send keeps them for the next flush; resending
 * is safe because the API keeps one event per `seq`.
 */
export function createEventLog(opts: {
  lastSeq: number;
  append: (events: NumberedEvent[]) => Promise<unknown>;
}) {
  let seq = opts.lastSeq;
  const pending: NumberedEvent[] = [];
  let chain: Promise<void> = Promise.resolve();

  async function send() {
    while (pending.length > 0) {
      const batch = pending.slice(0, MAX_PER_CALL);
      await opts.append(batch);
      pending.splice(0, batch.length);
    }
  }

  return {
    add(events: EventsRequest["events"]) {
      for (const e of events) pending.push({ ...e, seq: ++seq });
    },
    /** Takes the next number for a record that isn't an event (a suspend). */
    nextSeq(): number {
      return ++seq;
    },
    /** Sends everything held, one flush at a time; rejects if a send fails. */
    flush(): Promise<void> {
      chain = chain.catch(() => {}).then(send);
      return chain;
    },
  };
}

/** Timers a run uses; tests pass ones they fire by hand. */
export type Timers = {
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
};

export const realTimers: Timers = {
  every(ms, fn) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
  after(ms, fn) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

type Message = MessagesResponse["messages"][number];

/**
 * The person's messages waiting for the runner's `GET /messages`. A take with
 * nothing queued waits for a push, the timeout, `close` or the runner hanging up.
 */
export function createInbox(initial: Message[], timers: Timers) {
  const queue = [...initial];
  const waiters = new Set<() => void>();
  let closed = false;
  const wake = () => {
    for (const w of [...waiters]) w();
  };

  return {
    push(messages: Message[]) {
      if (messages.length === 0) return;
      queue.push(...messages);
      wake();
    },
    async take(waitSeconds: number, gone: AbortSignal): Promise<Message[]> {
      if (queue.length === 0 && waitSeconds > 0 && !closed) {
        await new Promise<void>((resolve) => {
          const stopWaiting = () => {
            waiters.delete(stopWaiting);
            cancelTimer();
            gone.removeEventListener("abort", stopWaiting);
            resolve();
          };
          const cancelTimer = timers.after(waitSeconds * 1000, stopWaiting);
          waiters.add(stopWaiting);
          gone.addEventListener("abort", stopWaiting);
        });
      }
      // A runner that hung up would lose what it was handed.
      return gone.aborted ? [] : queue.splice(0);
    },
    /** Answers every waiting take; later takes don't wait. */
    close() {
      closed = true;
      wake();
    },
  };
}
