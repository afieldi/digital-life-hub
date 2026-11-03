import type { AnyProcedure, AnyRouter } from "@trpc/server";
import { appRouter } from "../src/router";
import { createTestApi } from "../src/testing";

/** The only procedures callable without a session. */
const PUBLIC = new Set(["auth.start", "auth.exchange", "auth.devSignIn"]);

// tRPC keeps a flat path → procedure map beside the nested record.
const router: AnyRouter = appRouter;
const procedures = Object.entries(router._def.procedures).filter(
  (entry): entry is [string, AnyProcedure] =>
    typeof entry[1] === "function" && "_def" in entry[1],
);

test("the public allowlist names real procedures", () => {
  const paths = new Set(procedures.map(([path]) => path));
  for (const path of PUBLIC) expect(paths).toContain(path);
});

// Walks the whole router, so a new module's procedures are covered as they land.
// No database: auth runs before input parsing and before any query.
test.each(procedures.filter(([path]) => !PUBLIC.has(path)))(
  "%s without a token is UNAUTHORIZED",
  async (path, proc) => {
    const api = createTestApi();
    const url = `http://api.test/trpc/${path}`;
    const res =
      proc._def.type === "query"
        ? await api.fetch(`${url}?input=${encodeURIComponent("{}")}`)
        : await api.fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
  },
);
