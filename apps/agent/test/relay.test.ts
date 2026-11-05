import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPrices, gatewayModelId, type Price } from "../src/relay/prices";
import { createRelay, RelayError } from "../src/relay/relay";
import { fakeAnthropic, type ScriptedTurn } from "./fakeAnthropic";

const OPUS: Price = {
  input: 0.000004,
  output: 0.00002,
  cacheRead: 0.0000002,
  cacheWrite: 0.000005,
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function setup(script: ScriptedTurn[]) {
  const upstream = await fakeAnthropic(script);
  closers.push(upstream.close);
  const relay = createRelay({
    gatewayUrl: upstream.url,
    gatewayKey: "real-gateway-key",
    prices: { priceOf: async () => OPUS },
    retryDelayMs: () => 0,
  });
  // Serve the relay on a port the way the container's forwarder reaches it.
  let failure: unknown;
  const server: Server = createServer((req, res) => {
    relay.handle(req, res).catch((e) => {
      failure = e;
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (headers: Record<string, string> = {}) =>
    fetch(`${base}/model/v1/messages`, {
      method: "POST",
      headers: {
        authorization: "Bearer dlh-run",
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...headers,
      },
      body: JSON.stringify({ model: "claude-opus-5-5", messages: [] }),
    });
  return { upstream, relay, call, failure: () => failure };
}

const turn: ScriptedTurn = {
  text: "hi",
  usage: {
    input_tokens: 6,
    cache_creation_input_tokens: 14886,
    cache_read_input_tokens: 29169,
    output_tokens: 402,
  },
};

describe("gatewayModelId", () => {
  it("maps claude-opus-5-5 to anthropic/claude-opus-5.5 and drops a date suffix", () => {
    expect(gatewayModelId("claude-opus-5-5")).toBe("anthropic/claude-opus-5.5");
    expect(gatewayModelId("claude-sonnet-4-5-20250929")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
    expect(gatewayModelId("claude-haiku-4-5-20251001")).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  it("leaves an id without a minor version alone and keeps a provider-qualified id", () => {
    expect(gatewayModelId("claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
    expect(gatewayModelId("anthropic/claude-opus-5.5")).toBe(
      "anthropic/claude-opus-5.5",
    );
  });
});

describe("createPrices", () => {
  const list = {
    data: [
      {
        id: "anthropic/claude-opus-5.5",
        pricing: {
          input: "0.000004",
          output: "0.00002",
          input_cache_read: "0.0000002",
          input_cache_write: "0.000005",
        },
      },
      {
        id: "anthropic/claude-haiku-4.5",
        pricing: { input: 0.000001, output: 0.000005 },
      },
      { id: "openai/gpt-9", pricing: { input: "1", output: "1" } },
      { id: "anthropic/claude-nothing" },
    ],
  };

  it("an unknown model costs the highest Anthropic price", async () => {
    const f = (async () => Response.json(list)) as unknown as typeof fetch;
    const prices = createPrices(f, () => 0);
    expect(await prices.priceOf("claude-opus-5-5")).toEqual(OPUS);
    expect(await prices.priceOf("claude-mystery-9-9")).toEqual(OPUS);
    // A model without a price is "unknown" too, and a missing cache price falls back to input.
    expect(await prices.priceOf("claude-nothing")).toEqual(OPUS);
    expect(await prices.priceOf("claude-haiku-4-5")).toEqual({
      input: 0.000001,
      output: 0.000005,
      cacheRead: 0.000001,
      cacheWrite: 0.000001,
    });
  });

  it("caches the list for an hour", async () => {
    let calls = 0;
    let t = 0;
    const f = (async () => {
      calls++;
      return Response.json(list);
    }) as unknown as typeof fetch;
    const prices = createPrices(f, () => t);
    await prices.priceOf("claude-opus-5-5");
    t = 59 * 60_000;
    await prices.priceOf("claude-opus-5-5");
    expect(calls).toBe(1);
    t = 61 * 60_000;
    await prices.priceOf("claude-opus-5-5");
    expect(calls).toBe(2);
  });
});

describe("relay", () => {
  it("the container's token is replaced by the Gateway key", async () => {
    const { upstream, call } = await setup([turn]);
    await (await call({ "x-api-key": "dlh-run" })).text();
    const seen = upstream.requests[0];
    expect(seen?.url).toBe("/v1/messages");
    expect(seen?.headers.authorization).toBe("Bearer real-gateway-key");
    expect(seen?.headers["x-api-key"]).toBeUndefined();
    expect(seen?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(seen?.body ?? "{}").model).toBe("claude-opus-5-5");
  });

  it("a streamed response passes through byte for byte", async () => {
    const { upstream, call } = await setup([turn]);
    const direct = await (
      await fetch(`${upstream.url}/v1/messages`, { method: "POST", body: "{}" })
    ).text();
    const relayed = await (await call()).text();
    expect(relayed).toBe(direct);
    expect(relayed).toContain("message_stop");
  });

  it("usage and cost add up across turns", async () => {
    const { relay, call } = await setup([turn, turn]);
    await (await call()).text();
    const one = relay.usage();
    expect(one.turns).toBe(1);
    expect(one.inputTokens).toBe(6 + 14886 + 29169);
    expect(one.outputTokens).toBe(402);
    expect(one.costUsd).toBeCloseTo(0.0883, 4);
    await (await call()).text();
    expect(relay.usage().turns).toBe(2);
    expect(relay.usage().costUsd).toBeCloseTo(0.17666, 4);
  });

  it("reads usage from a JSON body too", async () => {
    const json = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }),
      );
    });
    await new Promise<void>((r) => json.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise<void>((r) => json.close(() => r())));
    const relay = createRelay({
      gatewayUrl: `http://127.0.0.1:${(json.address() as AddressInfo).port}`,
      gatewayKey: "k",
      prices: { priceOf: async () => OPUS },
    });
    const front = createServer((req, res) => void relay.handle(req, res));
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
    closers.push(
      () =>
        new Promise<void>((r) => {
          front.closeAllConnections();
          front.close(() => r());
        }),
    );
    const res = await fetch(
      `http://127.0.0.1:${(front.address() as AddressInfo).port}/model/v1/messages`,
      { method: "POST", body: JSON.stringify({ model: "claude-opus-5-5" }) },
    );
    await res.text();
    expect(relay.usage()).toMatchObject({
      turns: 1,
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('402 is "AI budget reached"', async () => {
    const { call, failure } = await setup([{ status: 402, usage: zero() }]);
    const res = await call();
    expect(res.status).toBe(402);
    await res.text();
    await until(() => failure() !== undefined);
    expect(failure()).toBeInstanceOf(RelayError);
    expect(failure()).toMatchObject({
      code: "budget",
      message: "AI budget reached",
    });
  });

  it("429 retries three times, then fails", async () => {
    const { upstream, call, failure } = await setup([
      { status: 429, usage: zero() },
    ]);
    const res = await call();
    expect(res.status).toBe(429);
    await res.text();
    expect(upstream.requests).toHaveLength(4);
    await until(() => failure() !== undefined);
    expect(failure()).toMatchObject({
      code: "rate_limited",
      message: "Rate limited by the AI Gateway",
    });
  });

  it("429 that clears on a retry is invisible to the container", async () => {
    const { upstream, call, failure, relay } = await setup([
      { status: 429, usage: zero() },
      turn,
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    await res.text();
    expect(upstream.requests).toHaveLength(2);
    expect(failure()).toBeUndefined();
    expect(relay.usage().turns).toBe(1);
  });
});

const zero = () => ({ input_tokens: 0, output_tokens: 0 });
async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++)
    await new Promise((r) => setTimeout(r, 10));
}
