import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AiError, publicProcedure, router } from "../src";
import { testAiDeps } from "../src/testing";
import type { CoreDeps } from "../src/trpc";

const appRouter = router({
  ai: publicProcedure.query(() => {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This suggestion expired.",
      cause: new AiError("expired", "This suggestion expired."),
    });
  }),
  plain: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "nope" });
  }),
});

async function call(path: string, devErrors: boolean) {
  const deps = { devErrors, ai: testAiDeps() } as CoreDeps;
  const res = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(`http://x/trpc/${path}`),
    router: appRouter,
    createContext: () => ({ deps, session: null }),
  });
  return (await res.json()) as { error: { data: Record<string, unknown> } };
}

test("an AiError cause is sent as data.ai", async () => {
  for (const devErrors of [true, false]) {
    const { error } = await call("ai", devErrors);
    expect(error.data.ai).toEqual({
      code: "expired",
      message: "This suggestion expired.",
    });
    expect("stack" in error.data).toBe(devErrors);
  }
});

test("other errors have no data.ai", async () => {
  const { error } = await call("plain", false);
  expect(error.data.ai).toBeUndefined();
  expect(error.data.code).toBe("NOT_FOUND");
});
