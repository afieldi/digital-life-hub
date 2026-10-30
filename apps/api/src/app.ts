import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
  app.use(
    "/trpc/*",
    trpcServer({
      endpoint: "/trpc",
      router: appRouter,
      createContext: (_opts, c) =>
        createContext(deps, c.req.header("Authorization")),
    }),
  );
  return app;
}
