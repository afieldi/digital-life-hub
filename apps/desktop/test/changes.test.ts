import { createSseParser, subscribeChanges } from "../src/api/changes";

function sseResponse() {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push: (s: string) => controller.enqueue(enc.encode(s)),
    end: () => controller.close(),
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("createSseParser", () => {
  test("handles chunks split mid-line and ignores comments", () => {
    const got: string[] = [];
    const feed = createSseParser((d) => got.push(d));
    feed('data: {"ids":["a"');
    expect(got).toEqual([]);
    feed("]}\n\n: ping\n\n");
    expect(got).toEqual(['{"ids":["a"]}']);
  });

  test("joins multi-line data and handles CRLF", () => {
    const got: string[] = [];
    const feed = createSseParser((d) => got.push(d));
    feed("data: one\r\ndata: two\r\n\r\n");
    expect(got).toEqual(["one\ntwo"]);
  });
});

describe("subscribeChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(fetchImpl: typeof fetch, backoffMs?: (n: number) => number) {
    const handlers = {
      onIds: vi.fn(),
      onReconnect: vi.fn(),
      onUnauthorized: vi.fn(),
    };
    const stop = subscribeChanges({
      url: "http://x/changes",
      getToken: async () => "t",
      fetch: fetchImpl,
      backoffMs,
      ...handlers,
    });
    return { handlers, stop };
  }

  test("sends the bearer token and delivers ids", async () => {
    const s = sseResponse();
    const fetchMock = vi.fn().mockResolvedValue(s.response);
    const { handlers, stop } = setup(fetchMock as unknown as typeof fetch);
    await flush();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t");
    s.push('data: {"ids":["a","b"]}\n\n');
    await flush();
    expect(handlers.onIds).toHaveBeenCalledWith(["a", "b"]);
    expect(handlers.onReconnect).toHaveBeenCalledTimes(1); // first open
    stop();
  });

  test("a 401 signs out and does not retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 401 }));
    const { handlers } = setup(fetchMock as unknown as typeof fetch);
    await flush();
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a dropped stream retries after the backoff, then reports a reconnect again", async () => {
    const first = sseResponse();
    const second = sseResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const backoff = vi.fn(() => 500);
    const { handlers, stop } = setup(
      fetchMock as unknown as typeof fetch,
      backoff,
    );
    await flush();
    expect(handlers.onReconnect).toHaveBeenCalledTimes(1);
    first.end();
    await flush();
    expect(backoff).toHaveBeenCalledWith(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handlers.onReconnect).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a network error retries and backs off exponentially, capped at 30s", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { stop } = setup(fetchMock as unknown as typeof fetch);
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [i, d] of delays.entries()) {
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(d - 1);
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(delays.length + 1);
    stop();
  });

  test("the stop function aborts the fetch and ends retries", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_u: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const { stop } = setup(fetchMock as unknown as typeof fetch);
    await flush();
    expect(signal?.aborted).toBe(false);
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("backoff restarts at 0 after a successful connection", async () => {
    const ok = sseResponse();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ok.response)
      .mockRejectedValue(new TypeError("offline"));
    const backoff = vi.fn((n: number) => (n + 1) * 10);
    const { stop } = setup(fetchMock as unknown as typeof fetch, backoff);
    await vi.advanceTimersByTimeAsync(100);
    ok.end();
    await vi.advanceTimersByTimeAsync(100);
    expect(backoff.mock.calls.map((c) => c[0]).slice(0, 4)).toEqual([
      0, 1, 0, 1,
    ]);
    stop();
  });

  test("stopping during a pending backoff prevents the retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { stop } = setup(fetchMock as unknown as typeof fetch);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("stop cancels an open body even when fetch ignores the signal", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    const { stop } = setup(fetchMock as unknown as typeof fetch);
    await flush();
    stop();
    await flush();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  test("an onIds exception is not swallowed and does not drop the stream", async () => {
    const s = sseResponse();
    const fetchMock = vi.fn().mockResolvedValue(s.response);
    const boom = new Error("handler bug");
    const caught: unknown[] = [];
    const onUncaught = (e: unknown) => caught.push(e);
    process.on("uncaughtException", onUncaught);
    const { handlers, stop } = setup(fetchMock as unknown as typeof fetch);
    handlers.onIds.mockImplementation(() => {
      throw boom;
    });
    await flush();
    s.push('data: {"ids":["a"]}\n\n');
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    process.off("uncaughtException", onUncaught);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caught).toContain(boom);
    stop();
  });

  test("an onUnauthorized exception does not trigger a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 401 }));
    const caught: unknown[] = [];
    const onRejected = (e: unknown) => caught.push(e);
    process.on("unhandledRejection", onRejected);
    const { handlers } = setup(fetchMock as unknown as typeof fetch);
    handlers.onUnauthorized.mockImplementation(() => {
      throw new Error("x");
    });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    process.off("unhandledRejection", onRejected);
    expect(caught).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
