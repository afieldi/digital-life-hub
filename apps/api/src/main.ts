import { createDb } from "@dlh/db";
import {
  createCoreDeps,
  createOpenRouter,
  createVercelGateway,
  devFakeAi,
} from "@dlh/server";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { createApp } from "./app";
import { drizzleAuthStore } from "./auth/drizzleStore";
import { createGoogleOAuth } from "./auth/google";
import { startPurgeJob } from "./changes";
import { ConfigError, loadConfig } from "./config";
import { migrateAll } from "./migrate";
import { serverModules } from "./modules.gen";
import { composed } from "./router";

function loadConfigOrExit() {
  try {
    return loadConfig(process.env, serverModules);
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
const { db, close } = createDb(config.databaseUrl);

try {
  await db.execute(sql`select 1`);
} catch (err) {
  // Drizzle wraps the driver's error: the code and message are on the cause.
  const cause: { code?: string; message?: string } =
    err instanceof Error && err.cause instanceof Error ? err.cause : {};
  const why =
    cause.message ?? (err instanceof Error ? err.message : String(err));
  console.error(
    cause.code === "ECONNREFUSED"
      ? `Can't reach Postgres at ${hostPort(config.databaseUrl)} — is Docker running? (pnpm dev starts it.)`
      : `Can't use the database at ${hostPort(config.databaseUrl)}: ${why}`,
  );
  await close().catch(() => {});
  process.exit(1);
}

if (config.migrateOnStart) {
  await migrateAll(config.databaseUrl, serverModules, {
    ...(config.migrationsRoot ? { root: config.migrationsRoot } : {}),
  });
}

const deps = {
  ...createCoreDeps(composed, {
    db,
    devErrors: config.devAuth,
    moduleConfig: config.moduleConfig,
    ai: config.aiFake
      ? devFakeAi(composed.aiRunners.values())
      : {
          providers: {
            ...(config.openrouter.apiKey
              ? {
                  openrouter: createOpenRouter({
                    apiKey: config.openrouter.apiKey,
                  }),
                }
              : {}),
            ...(config.aiGateway.apiKey
              ? {
                  vercel: createVercelGateway({
                    apiKey: config.aiGateway.apiKey,
                  }),
                }
              : {}),
          },
          defaultModels: {
            ...(config.openrouter.defaultModel
              ? { openrouter: config.openrouter.defaultModel }
              : {}),
            ...(config.aiGateway.defaultModel
              ? { vercel: config.aiGateway.defaultModel }
              : {}),
          },
        },
  }),
  config,
  store: drizzleAuthStore(db),
  google: createGoogleOAuth(config.google),
};
const app = createApp(deps);
startPurgeJob(deps);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
});
