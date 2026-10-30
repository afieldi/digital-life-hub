import { DEFAULT_DATABASE_URL } from "@dlh/db";

export type Config = {
  port: number;
  databaseUrl: string;
  google: { clientId: string; clientSecret: string };
  allowedEmail: string;
  devAuth: boolean;
};

export class ConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Invalid configuration: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (missing.length > 0) throw new ConfigError(missing);

  return {
    port: Number(env.PORT) || 8787,
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    google: { clientId, clientSecret },
    allowedEmail,
    devAuth: env.NODE_ENV === "development",
  };
}
