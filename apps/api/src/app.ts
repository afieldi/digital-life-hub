import { trpcServer } from "@hono/trpc-server";
import type { AnyRouter } from "@trpc/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { changesHandler } from "./changes";
import { appRouter } from "./router";
import { type AppDeps, createContext } from "./trpc";

export const ALLOWED_ORIGINS = [
  "http://localhost:1420",
  "tauri://localhost",
  "http://tauri.localhost",
];

/** `router` is the API's own unless a test mounts more modules (`createTestApi`). */
export function createApp(deps: AppDeps, router: AnyRouter = appRouter): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/changes", changesHandler(deps));
  app.use(
    "/trpc/*",
    trpcServer({
      endpoint: "/trpc",
      router,
      onError: ({ error, path }) => {
        const at = `tRPC ${error.code} on ${path ?? "<unknown>"}`;
        // A bug: the whole error, with its cause chain and stack.
        if (error.code === "INTERNAL_SERVER_ERROR") console.error(at, error);
        // An upstream failure (Google, a model): its message is enough.
        else if (error.code === "BAD_GATEWAY") {
          console.error(`${at}: ${error.message}`);
        }
      },
      createContext: (_opts, c) =>
        createContext(deps, c.req.header("Authorization")),
    }),
  );
  return app;
}
