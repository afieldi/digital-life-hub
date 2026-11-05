import type { IncomingMessage, ServerResponse } from "node:http";
import type { Price } from "./prices";

/** A model call the run can't go on from; Task 6 fails the run with `code` and `message`. */
export class RelayError extends Error {
  constructor(
    readonly code: "budget" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

export type Usage = {
  turns: number;
  /** Input, cache write and cache read tokens together. */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

type Counts = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

const RETRIES = 3;
// Hop-by-hop or recomputed by node when we answer.
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "authorization",
  "x-api-key",
]);
const DROP_RESPONSE = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "keep-alive",
]);

const int = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);

/** Folds a usage object into `c`; `output_tokens` is cumulative so it replaces. */
function readUsage(c: Counts, u: unknown) {
  if (typeof u !== "object" || u === null) return;
  const x = u as Record<string, unknown>;
  if ("input_tokens" in x) c.input = int(x.input_tokens);
  if ("cache_creation_input_tokens" in x)
    c.cacheWrite = int(x.cache_creation_input_tokens);
  if ("cache_read_input_tokens" in x)
    c.cacheRead = int(x.cache_read_input_tokens);
  if ("output_tokens" in x) c.output = int(x.output_tokens);
}

/** Reads usage from SSE bytes as they go by. */
function sseUsageReader(c: Counts) {
  const decoder = new TextDecoder();
  let pending = "";
  const line = (l: string) => {
    if (!l.startsWith("data:")) return;
    try {
      const ev = JSON.parse(l.slice(5)) as {
        type?: string;
        message?: { usage?: unknown };
        usage?: unknown;
      };
      if (ev.type === "message_start") readUsage(c, ev.message?.usage);
      else if (ev.type === "message_delta") readUsage(c, ev.usage);
    } catch {
      // Not JSON (a ping or a partial line); not ours to judge.
    }
  };
  return (chunk?: Uint8Array) => {
    pending += chunk
      ? decoder.decode(chunk, { stream: true })
      : `${decoder.decode()}\n`;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const l of lines) line(l.replace(/\r$/, ""));
  };
}

export function createRelay(opts: {
  gatewayUrl: string;
  gatewayKey: string;
  prices: { priceOf(model: string): Promise<Price> };
  fetch?: typeof fetch;
  /** Wait before retry number `attempt` (0-based) of a 429. */
  retryDelayMs?: (attempt: number) => number;
}) {
  const fetchFn = opts.fetch ?? fetch;
  const delay = opts.retryDelayMs ?? ((n: number) => 1000 * 2 ** n);
  const base = opts.gatewayUrl.replace(/\/+$/, "");
  const total: Usage = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  function record(c: Counts, price: Price) {
    total.turns++;
    total.inputTokens += c.input + c.cacheWrite + c.cacheRead;
    total.outputTokens += c.output;
    total.costUsd +=
      c.input * price.input +
      c.cacheWrite * price.cacheWrite +
      c.cacheRead * price.cacheRead +
      c.output * price.output;
  }

  async function body(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? "";
    if (!url.startsWith("/model/")) {
      res.writeHead(404).end();
      return;
    }
    const path = url.slice("/model".length);
    const isTurn =
      req.method === "POST" && path.split("?")[0] === "/v1/messages";
    const payload = await body(req);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || DROP_REQUEST.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    headers.authorization = `Bearer ${opts.gatewayKey}`;

    let price: Price | undefined;
    if (isTurn) {
      try {
        const model = (
          JSON.parse(payload.toString("utf8")) as { model?: unknown }
        ).model;
        price = await opts.prices.priceOf(
          typeof model === "string" ? model : "",
        );
      } catch {
        res.writeHead(502).end();
        throw new Error("Could not price the model call");
      }
    }

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    let upstream: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        upstream = await fetchFn(base + path, {
          method: req.method,
          headers,
          body:
            req.method === "GET" || req.method === "HEAD"
              ? undefined
              : new Uint8Array(payload),
          signal: abort.signal,
        });
      } catch {
        if (!res.headersSent) res.writeHead(502);
        res.end();
        return;
      }
      if (upstream.status !== 429 || attempt >= RETRIES) break;
      await upstream.body?.cancel();
      await new Promise((r) => setTimeout(r, delay(attempt)));
    }

    const out: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      if (!DROP_RESPONSE.has(k)) out[k] = v;
    });
    res.writeHead(upstream.status, out);

    const counts: Counts = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    const ok = upstream.ok;
    const isSse = (upstream.headers.get("content-type") ?? "").includes(
      "text/event-stream",
    );
    const readSse = sseUsageReader(counts);
    const whole: Buffer[] = [];

    if (upstream.body) {
      try {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          res.write(chunk);
          if (ok && isTurn) {
            if (isSse) readSse(chunk);
            else whole.push(Buffer.from(chunk));
          }
        }
      } catch {
        // The stream broke or the container hung up; count what was seen.
      }
    }
    res.end();

    if (ok && isTurn && price) {
      if (isSse) readSse();
      else {
        try {
          readUsage(
            counts,
            (
              JSON.parse(Buffer.concat(whole).toString("utf8")) as {
                usage?: unknown;
              }
            ).usage,
          );
        } catch {
          // No usage to read.
        }
      }
      record(counts, price);
    }

    if (upstream.status === 402)
      throw new RelayError("budget", "AI budget reached");
    if (upstream.status === 429)
      throw new RelayError("rate_limited", "Rate limited by the AI Gateway");
  }

  return { handle, usage: (): Usage => ({ ...total }) };
}
