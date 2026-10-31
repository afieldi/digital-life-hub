import { trpcServer } from "@hono/trpc-server";
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

export function createApp(deps: AppDeps): Hono {
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
      router: appRouter,
      onError: ({ error, path }) => {
        if (
          error.code === "INTERNAL_SERVER_ERROR" ||
          error.code === "BAD_GATEWAY"
        ) {
          console.error(`tRPC ${error.code} on ${path ?? "<unknown>"}`);
        }
      },
      createContext: (_opts, c) =>
        createContext(deps, c.req.header("Authorization")),
    }),
  );
  return app;
}
