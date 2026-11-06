import { DEFAULT_DATABASE_URL } from "@dlh/db";
import { loadModuleConfigs, type ServerModule } from "@dlh/server";

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Invalid configuration: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

/**
 * A config section: what it read from `env`, plus the variables it found
 * missing or invalid. `loadConfig` composes sections and throws once for all
 * of them; a CLI loads only the sections it needs.
 */
type Section<T> = { value: T; missing: string[] };

/** A section's value, or a ConfigError naming everything it lacks. */
export function must<T>({ value, missing }: Section<T>): T {
  if (missing.length > 0) throw new ConfigError(missing);
  return value;
}

/** `DATABASE_URL`: required in production, else the local Docker database. */
export function databaseSection(env: Env): Section<{ url: string }> {
  const url = env.DATABASE_URL?.trim();
  if (url) return { value: { url }, missing: [] };
  return env.NODE_ENV === "production"
    ? { value: { url: "" }, missing: ["DATABASE_URL"] }
    : { value: { url: DEFAULT_DATABASE_URL }, missing: [] };
}

/** OpenRouter's key and default model: both optional, trimmed, empty is none. */
export function openrouterSection(
  env: Env,
): Section<{ apiKey: string | null; defaultModel: string | null }> {
  return {
    value: {
      apiKey: env.OPENROUTER_API_KEY?.trim() || null,
      defaultModel: env.OPENROUTER_DEFAULT_MODEL?.trim() || null,
    },
    missing: [],
  };
}

/** Vercel AI Gateway's key and default model: both optional, trimmed, empty is none. */
export function aiGatewaySection(
  env: Env,
): Section<{ apiKey: string | null; defaultModel: string | null }> {
  return {
    value: {
      apiKey: env.AI_GATEWAY_API_KEY?.trim() || null,
      defaultModel: env.AI_GATEWAY_DEFAULT_MODEL?.trim() || null,
    },
    missing: [],
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** Where and how the API listens and starts. */
function serverSection(env: Env): Section<{
  port: number;
  host: string;
  devAuth: boolean;
  /** The scripted dev AI provider (`AI_FAKE_PROVIDER=1`, dev only). */
  aiFake: boolean;
  migrateOnStart: boolean;
  /** Holds `packages/db/drizzle` and `modules/<id>/drizzle` (default: the repo root). */
  migrationsRoot: string | null;
}> {
  const missing: string[] = [];
  const rawPort = env.PORT?.trim();
  const port = rawPort ? Number(rawPort) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    missing.push("PORT (a whole number from 1 to 65535)");
  }
  const host = env.HOST?.trim() || "127.0.0.1";
  const devAuth = env.NODE_ENV === "development";
  // Dev auth signs in without credentials, so it only listens on this machine.
  if (devAuth && !LOOPBACK.has(host)) {
    missing.push("HOST (loopback only when NODE_ENV=development)");
  }
  return {
    value: {
      port,
      host,
      devAuth,
      aiFake: devAuth && env.AI_FAKE_PROVIDER === "1",
      migrateOnStart: env.MIGRATE_ON_START === "1",
      migrationsRoot: env.MIGRATIONS_ROOT?.trim() || null,
    },
    missing,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Google sign-in and the one account allowed in. */
function authSection(env: Env): Section<{
  google: { clientId: string; clientSecret: string };
  allowedEmail: string;
}> {
  const missing: string[] = [];
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };
  const clientId = required("GOOGLE_CLIENT_ID");
  const clientSecret = required("GOOGLE_CLIENT_SECRET");
  const allowedEmail = required("ALLOWED_EMAIL").toLowerCase();
  if (allowedEmail && !EMAIL.test(allowedEmail)) missing.push("ALLOWED_EMAIL");
  return {
    value: { google: { clientId, clientSecret }, allowedEmail },
    missing,
  };
}

export type Config = ReturnType<typeof serverSection>["value"] &
  ReturnType<typeof authSection>["value"] & {
    databaseUrl: string;
    openrouter: ReturnType<typeof openrouterSection>["value"];
    aiGateway: ReturnType<typeof aiGatewaySection>["value"];
    /** Each module's own settings (`ServerModule.config`), checked. */
    moduleConfig: ReadonlyMap<string, unknown>;
  };

/** Everything the API and its `modules` read from the environment, checked at once. */
export function loadConfig(
  env: Env,
  modules: readonly ServerModule[] = [],
): Config {
  const auth = authSection(env);
  const server = serverSection(env);
  const database = databaseSection(env);
  const openrouter = openrouterSection(env);
  const aiGateway = aiGatewaySection(env);
  const moduleConfig = loadModuleConfigs(modules, env);
  const missing = [
    ...auth.missing,
    ...server.missing,
    ...database.missing,
    ...openrouter.missing,
    ...aiGateway.missing,
    ...moduleConfig.missing,
  ];
  if (missing.length > 0) throw new ConfigError(missing);
  return {
    ...server.value,
    ...auth.value,
    databaseUrl: database.value.url,
    openrouter: openrouter.value,
    aiGateway: aiGateway.value,
    moduleConfig: moduleConfig.values,
  };
}
