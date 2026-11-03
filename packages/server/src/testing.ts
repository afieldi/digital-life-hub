import { join } from "node:path";
import type { AiProviderId } from "@dlh/core";
import { fixtureOps } from "@dlh/core/fixture";
import { type Db, items, migrate } from "@dlh/db";
import { freshTestDb } from "@dlh/db/testing";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { z } from "zod";
import { coreAiRunners } from "./ai/core-runners";
import { AiError, aiErrorMessage } from "./ai/errors";
import type { AiDeps } from "./ai/gateway";
import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./ai/providers";
import type { RunnerTools } from "./ai/runners";
import { createChangeBus } from "./changes";
import { composeServer } from "./compose";
import { migrationsRoot, moduleMigrations } from "./migrations";
import { defineServerModule, type ServerModule } from "./modules";
import {
  type ImplementedOperation,
  implementOperation,
} from "./operations/implement";
import { type Context, type CoreDeps, type DeleteWith, router } from "./trpc";

export { freshTestDb } from "@dlh/db/testing";

/**
 * `freshTestDb()`, then each module's migrations. `root` holds `packages/db/drizzle`
 * and `modules/<id>/drizzle` (default `MIGRATIONS_ROOT`, else the repo root); jsdom
 * tests pass it because `import.meta.url` is no file URL there.
 */
export async function freshModuleDb(
  modules: readonly ServerModule[],
  root?: string,
): Promise<{ db: Db; url: string; close: () => Promise<void> }> {
  const base = root ?? migrationsRoot();
  const t = await freshTestDb(join(base, "packages", "db", "drizzle"));
  try {
    for (const m of moduleMigrations(modules, base)) {
      await migrate(t.url, m.folder, { table: m.table });
    }
  } catch (e) {
    await t.close();
    throw e;
  }
  return t;
}

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
  opts: {
    itemTypes?: string[];
    now?: () => Date;
    ai?: Partial<AiDeps>;
    deleteWith?: Record<string, DeleteWith> | ReadonlyMap<string, DeleteWith>;
    operations?: ReadonlyMap<string, ImplementedOperation>;
  } = {},
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
    deleteWith: new Map(
      opts.deleteWith instanceof Map
        ? opts.deleteWith
        : Object.entries(opts.deleteWith ?? {}),
    ),
    operations: opts.operations ?? new Map(),
    moduleConfig: new Map(),
    fakeProvider,
    setNow(date) {
      clock = date;
    },
  };
}

/** The session `testServer`'s caller is signed in as. */
export const TEST_SESSION = { id: "s", email: "arek@example.com" };

/**
 * `testDeps` wired to `modules` as the API composes them (their item types,
 * operations, deleteWith and AI runners, with Core's), and a caller over
 * Core's and the modules' routers, signed in. `itemTypes` adds more types,
 * e.g. one a test links to.
 */
export function testServer<const Mods extends readonly ServerModule[]>(
  db: Db,
  modules: Mods,
  opts: { itemTypes?: string[]; now?: () => Date } = {},
) {
  const composed = composeServer(modules);
  const deps = testDeps(db, {
    itemTypes: [...composed.itemTypes, ...(opts.itemTypes ?? [])],
    ...(opts.now ? { now: opts.now } : {}),
    deleteWith: composed.deleteWith,
    operations: composed.operations,
    ai: { runners: composed.aiRunners },
  });
  const caller = router(composed.routers).createCaller({
    // Where the API augments ApiDeps with its own deps (auth, config), this
    // has none of them; Core's and the modules' routers never read them.
    deps: deps as unknown as Context["deps"],
    session: TEST_SESSION,
  });
  return { deps, caller, operations: composed.operations };
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

/**
 * Contract for a module write: runs `run(itemId)` and asserts the item's `updated_at`
 * moved and its id was published to `/changes`.
 */
export function expectModuleWrites(
  deps: CoreDeps,
  run: (itemId: string) => Promise<unknown>,
  itemId: string,
): Promise<void> {
  return expectTracked(deps, { itemId }, () => run(itemId));
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

/**
 * `fixtureOps` implemented: a test-only module with item type `fixture`, for
 * tests of Core features that need some item and some module. Register it
 * with `testServer(db, [fixtureServer])` or `createTestApi({ modules })`.
 */
export const fixtureServer = defineServerModule({
  id: "fixture",
  itemTypes: ["fixture"],
  operations: {
    create: implementOperation(fixtureOps.create, {
      async run(w, input) {
        if (!w.createItem) throw new Error("fixture.create can't create");
        const item = await w.createItem({
          type: "fixture",
          title: input.title,
        });
        return { result: item, undo: null };
      },
      // Core removes the item it created; nothing else to revert.
      async undo() {},
      undoRecord: z.null(),
    }),
  },
});

/** Runner tools for a test whose runner never calls them: either call fails. */
export const noTools: RunnerTools = {
  mutate: () => Promise.reject(new Error("this test's runner has no tools")),
  revert: () => Promise.reject(new Error("this test's runner has no tools")),
};
