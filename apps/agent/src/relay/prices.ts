/** Dollars per token. */
export type Price = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const TTL_MS = 60 * 60_000;

/**
 * The Gateway's id for a model the container names: `claude-opus-5-5` is
 * `anthropic/claude-opus-5.5`, and a trailing `-YYYYMMDD` is dropped. An id that
 * already has a provider (`/`) is the Gateway's own and is returned as is.
 */
export function gatewayModelId(model: string): string {
  if (model.includes("/")) return model;
  const name = model.replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2");
  return `anthropic/${name}`;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** A price from a list entry; a missing cache price falls back to the input price. */
function parsePrice(pricing: unknown): Price | undefined {
  if (typeof pricing !== "object" || pricing === null) return undefined;
  const p = pricing as Record<string, unknown>;
  const input = num(p.input);
  const output = num(p.output);
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead: num(p.input_cache_read) ?? input,
    cacheWrite: num(p.input_cache_write) ?? input,
  };
}

/** Prices from the Gateway's model list, cached for an hour. */
export function createPrices(fetchFn: typeof fetch, now: () => number) {
  let cache:
    | { at: number; byId: Map<string, Price>; dearest: Price }
    | undefined;

  async function load() {
    if (cache && now() - cache.at < TTL_MS) return cache;
    try {
      const res = await fetchFn(MODELS_URL);
      if (!res.ok) throw new Error(`Gateway model list answered ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{ id?: unknown; pricing?: unknown }>;
      };
      const byId = new Map<string, Price>();
      let dearest: Price | undefined;
      for (const m of body.data ?? []) {
        const price = parsePrice(m.pricing);
        if (typeof m.id !== "string" || !price) continue;
        byId.set(m.id, price);
        // The dearest Anthropic model is the one with the highest output price.
        if (
          m.id.startsWith("anthropic/") &&
          (!dearest || price.output > dearest.output)
        )
          dearest = price;
      }
      if (!dearest)
        throw new Error("Gateway model list has no Anthropic prices");
      cache = { at: now(), byId, dearest };
    } catch (e) {
      // Keep pricing with the last list rather than stop a run over a refresh.
      if (!cache) throw e;
    }
    return cache;
  }

  return {
    /** The model's price, or the highest `anthropic/*` price when the Gateway lists none. Never zero. */
    async priceOf(model: string): Promise<Price> {
      const { byId, dearest } = await load();
      return byId.get(gatewayModelId(model)) ?? dearest;
    },
  };
}

export type Prices = ReturnType<typeof createPrices>;
