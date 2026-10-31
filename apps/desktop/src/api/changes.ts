export type ChangesHandlers = {
  onIds: (ids: string[]) => void;
  /** Called each time the stream opens, the first time included: refetch what was loaded before it was live. */
  onReconnect: () => void;
  onUnauthorized: () => void;
};

/** Subscribes to `/changes`; the returned function stops it. */
export type SubscribeChanges = (handlers: ChangesHandlers) => () => void;

const MAX_BACKOFF_MS = 30_000;
/** The server sends `: ping` every 25 s; 2.5x that without a byte means the connection is dead. */
export const DEFAULT_IDLE_TIMEOUT_MS = 62_500;

export function defaultBackoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
}

/**
 * Incremental parser for a server-sent-events stream. Feed it raw text chunks
 * (which may split anywhere); it calls `onData` once per event with the
 * `data:` lines joined by newlines. Comments (`: ping`) are ignored.
 */
export function createSseParser(
  onData: (data: string) => void,
): (chunk: string) => void {
  let buffer = "";
  let data: string[] = [];
  const line = (raw: string) => {
    if (raw === "") {
      if (data.length > 0) onData(data.join("\n"));
      data = [];
      return;
    }
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    data.push(value);
  };
  return (chunk) => {
    buffer += chunk;
    let match = /\r\n|\n|\r/.exec(buffer);
    while (match) {
      // A lone trailing \r may be the first half of \r\n; wait for more.
      if (match[0] === "\r" && match.index === buffer.length - 1) return;
      line(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      match = /\r\n|\n|\r/.exec(buffer);
    }
  };
}

export function subscribeChanges(
  opts: {
    url: string;
    getToken: () => Promise<string | null>;
    fetch?: typeof fetch;
    backoffMs?: (attempt: number) => number;
    /** Cancel and reconnect when no bytes (comments included) arrive for this long. */
    idleTimeoutMs?: number;
  } & ChangesHandlers,
): () => void {
  const doFetch = opts.fetch ?? fetch;
  const backoffMs = opts.backoffMs ?? defaultBackoffMs;
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  const run = async () => {
    let attempt = 0;
    let unauthorized = false;
    while (!controller.signal.aborted) {
      // Only network failures are retried; handler exceptions are not.
      try {
        const token = await opts.getToken();
        if (!token) {
          unauthorized = true;
          break;
        }
        const res = await doFetch(opts.url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (res.status === 401) {
          unauthorized = true;
          break;
        }
        if (!res.ok || !res.body) throw new Error(`changes: ${res.status}`);
        // Called on every open, the first included: events may have been
        // missed while disconnected, or before the stream first connected.
        opts.onReconnect();
        const parse = createSseParser((data) => {
          let ids: unknown;
          try {
            ids = (JSON.parse(data) as { ids?: unknown }).ids;
          } catch {
            return; // A malformed event is skipped; the stream stays up.
          }
          if (!Array.isArray(ids)) return;
          try {
            opts.onIds(ids as string[]);
          } catch (err) {
            // Surface a handler bug without tearing down the stream.
            queueMicrotask(() => {
              throw err;
            });
          }
        });
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        const cancel = () => void reader.cancel().catch(() => {});
        // Not every fetch ties the body to the signal (the in-process test
        // one does not), so cancel the reader explicitly.
        controller.signal.addEventListener("abort", cancel, { once: true });
        let idle: ReturnType<typeof setTimeout> | undefined;
        const armIdle = () => {
          clearTimeout(idle);
          idle = setTimeout(cancel, idleTimeoutMs);
        };
        try {
          armIdle();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            armIdle();
            // Only a connection that delivered bytes counts as healthy.
            attempt = 0;
            parse(value);
          }
        } finally {
          clearTimeout(idle);
          controller.signal.removeEventListener("abort", cancel);
        }
      } catch {
        // Fall through to the backoff below (an abort ends the loop).
      }
      if (controller.signal.aborted) return;
      await sleep(backoffMs(attempt++));
    }
    if (unauthorized) opts.onUnauthorized();
  };
  void run();

  return () => {
    controller.abort();
    clearTimeout(timer);
    wake?.();
  };
}
