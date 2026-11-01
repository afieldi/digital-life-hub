import type { AiProviderId } from "@dlh/core";
import { type Db, items } from "@dlh/db";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { coreAiRunners } from "./ai/core-runners";
import { AiError, aiErrorMessage } from "./ai/errors";
import type { AiDeps } from "./ai/gateway";
import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./ai/providers";
import { createChangeBus } from "./changes";
import type { CoreDeps } from "./trpc";

export { freshTestDb } from "@dlh/db/testing";

export type TestDeps = CoreDeps & {
  setNow(date: Date): void;
  /** The default `ai.providers.openrouter`; queue its outputs. */
  fakeProvider: FakeProvider;
};

/** Core AI actions and runners, with a FakeProvider as OpenRouter on model `test-model`. */
export function testAiDeps(
  overrides: Partial<AiDeps> = {},
  fake = new FakeProvider(),
): AiDeps {
  return {
    runners: new Map(coreAiRunners.map((r) => [r.action.id, r])),
    providers: { openrouter: fake },
    defaultModel: "test-model",
    ...overrides,
  };
}

/**
 * CoreDeps for tests: item type `test` by default, a clock frozen until `setNow`,
 * and `testAiDeps` (fields in `opts.ai` replace the defaults).
 */
export function testDeps(
  db: Db,
  opts: { itemTypes?: string[]; now?: () => Date; ai?: Partial<AiDeps> } = {},
): TestDeps {
  let clock = opts.now?.() ?? new Date("2026-10-30T12:00:00.000Z");
  const fakeProvider = new FakeProvider();
  return {
    db,
    changes: createChangeBus(),
    itemTypes: new Set(opts.itemTypes ?? ["test"]),
    now: () => clock,
    devErrors: true,
    ai: testAiDeps(opts.ai, fakeProvider),
    fakeProvider,
    setNow(date) {
      clock = date;
    },
  };
}

/**
 * Runs `run` and asserts the item id (`opts.itemId`, else the `id` it returns) was
 * published. With `opts.itemId`, also asserts the item's `updated_at` increased.
 */
export async function expectTracked(
  deps: CoreDeps,
  opts: { itemId?: string },
  run: () => Promise<unknown>,
): Promise<void> {
  const readUpdatedAt = async (id: string) => {
    const rows = await deps.db
      .select({ updatedAt: items.updatedAt })
      .from(items)
      .where(eq(items.id, id));
    return rows[0]?.updatedAt;
  };
  const published: string[] = [];
  const unsubscribe = deps.changes.subscribe((ids) => published.push(...ids));
  try {
    const before = opts.itemId ? await readUpdatedAt(opts.itemId) : undefined;
    const result = await run();
    const id =
      opts.itemId ??
      (typeof result === "object" && result !== null && "id" in result
        ? String(result.id)
        : undefined);
    if (!id) throw new Error("expectTracked: no item id to check");
    expect(published).toContain(id);
    if (opts.itemId) {
      const after = await readUpdatedAt(id);
      expect(before).toBeDefined();
      expect(after && before && after > before).toBe(true);
    }
  } finally {
    unsubscribe();
  }
}

type FakeOutput =
  | string
  | { error: AiError["code"] }
  | { raw: string; usage: NonNullable<AiCompleteResult["usage"]> }
  | { delayMs: number; raw: string };

/** Scripted AiProvider: `queue` outputs are replayed in order; requests are kept in `calls`. */
export class FakeProvider implements AiProvider {
  readonly calls: AiCompleteRequest[] = [];
  private outputs: FakeOutput[] = [];

  constructor(readonly id: AiProviderId = "openrouter") {}

  queue(...outputs: FakeOutput[]): this {
    this.outputs.push(...outputs);
    return this;
  }

  async complete(req: AiCompleteRequest): Promise<AiCompleteResult> {
    this.calls.push(req);
    const next = this.outputs.shift();
    if (next === undefined) throw new Error("FakeProvider: queue is empty");
    if (typeof next === "string") return { raw: next };
    if ("usage" in next) return { raw: next.raw, usage: next.usage };
    if ("error" in next) {
      throw new AiError(
        next.error,
        aiErrorMessage(next.error, this.id, {
          seconds: 60,
          firstLine: "fake",
          reason: this.id === "openrouter" ? "no_key" : "signed_out",
        }),
      );
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          new AiError(
            "provider_error",
            aiErrorMessage("provider_error", this.id, { firstLine: "aborted" }),
          ),
        );
      };
      const timer = setTimeout(() => {
        req.signal.removeEventListener("abort", onAbort);
        resolve();
      }, next.delayMs);
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener("abort", onAbort, { once: true });
    });
    return { raw: next.raw };
  }
}
