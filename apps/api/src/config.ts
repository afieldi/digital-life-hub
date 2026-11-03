import { DEFAULT_DATABASE_URL } from "@dlh/db";

export type Config = {
  port: number;
  host: string;
  databaseUrl: string;
  google: { clientId: string; clientSecret: string };
  allowedEmail: string;
  devAuth: boolean;
  openrouter: { apiKey: string | null; defaultModel: string | null };
};

export class ConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Invalid configuration: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env: Record<string, string | undefined>): Config {
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
  const host = env.HOST?.trim() || "127.0.0.1";
  const devAuth = env.NODE_ENV === "development";
  // Dev auth signs in without credentials, so it only listens on this machine.
  if (devAuth && !LOOPBACK.has(host))
    missing.push("HOST (loopback only when NODE_ENV=development)");
  if (missing.length > 0) throw new ConfigError(missing);

  return {
    port: Number(env.PORT) || 8787,
    host,
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    google: { clientId, clientSecret },
    allowedEmail,
    devAuth,
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY?.trim() || null,
      defaultModel: env.OPENROUTER_DEFAULT_MODEL?.trim() || null,
    },
  };
}
