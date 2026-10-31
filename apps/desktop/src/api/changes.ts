export type ChangesHandlers = {
  onIds: (ids: string[]) => void;
  onReconnect: () => void;
  onUnauthorized: () => void;
};

/** Subscribes to `/changes`; the returned function stops it. */
export type SubscribeChanges = (handlers: ChangesHandlers) => () => void;

const MAX_BACKOFF_MS = 30_000;

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
  } & ChangesHandlers,
): () => void {
  const doFetch = opts.fetch ?? fetch;
  const backoffMs = opts.backoffMs ?? defaultBackoffMs;
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
    let dropped = false;
    while (!controller.signal.aborted) {
      try {
        const token = await opts.getToken();
        if (!token) return opts.onUnauthorized();
        const res = await doFetch(opts.url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (res.status === 401) return opts.onUnauthorized();
        if (!res.ok || !res.body) throw new Error(`changes: ${res.status}`);
        attempt = 0;
        // Events may have been missed while disconnected.
        if (dropped) opts.onReconnect();
        const parse = createSseParser((data) => {
          try {
            const msg = JSON.parse(data) as { ids?: unknown };
            if (Array.isArray(msg.ids)) opts.onIds(msg.ids as string[]);
          } catch {
            // A malformed event is skipped; the stream stays up.
          }
        });
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(value);
        }
      } catch {
        // Fall through to the backoff below (an abort ends the loop).
      }
      if (controller.signal.aborted) return;
      dropped = true;
      await sleep(backoffMs(attempt++));
    }
  };
  void run();

  return () => {
    controller.abort();
    clearTimeout(timer);
    wake?.();
  };
}
