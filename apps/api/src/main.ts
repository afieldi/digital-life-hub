import { createDb, migrate } from "@dlh/db";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  createChangeBus,
} from "@dlh/server";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createApp } from "./app";
import { drizzleAuthStore } from "./auth/drizzleStore";
import { createGoogleOAuth } from "./auth/google";
import { startPurgeJob } from "./changes";
import { ConfigError, loadConfig } from "./config";
import { serverModules } from "./modules.gen";

function loadConfigOrExit() {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(
        `Missing ${err.missing.join(", ")} in apps/api/.env — see apps/api/.env.example.`,
      );
      process.exit(1);
    }
    throw err;
  }
}

function hostPort(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the configured DATABASE_URL";
  }
}

const config = loadConfigOrExit();
// Throws on a duplicate module id or item type, or an id that clashes with a core router.
const { itemTypes } = collectServerModules(
  [...serverModules],
  [...CORE_ROUTER_IDS],
);
const { db, close } = createDb(config.databaseUrl);

try {
  await db.execute(sql`select 1`);
} catch {
  console.error(
    `Can't reach Postgres at ${hostPort(config.databaseUrl)} — is Docker running? (pnpm dev starts it.)`,
  );
  await close().catch(() => {});
  process.exit(1);
}

if (process.env.MIGRATE_ON_START === "1") {
  await migrate(config.databaseUrl, "./drizzle");
}

const deps = {
  db,
  changes: createChangeBus(),
  itemTypes,
  devErrors: config.devAuth,
  config,
  store: drizzleAuthStore(db),
  google: createGoogleOAuth(config.google),
  now: () => new Date(),
};
const app = createApp(deps);
startPurgeJob(deps);

const hostname = process.env.HOST || "127.0.0.1";
serve({ fetch: app.fetch, port: config.port, hostname }, () => {
  console.log(`API listening on http://${hostname}:${config.port}`);
});
