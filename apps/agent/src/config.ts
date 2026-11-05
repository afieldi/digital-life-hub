import { z } from "zod";

const config = z.object({
  apiUrl: z.url(),
  workerToken: z.string().min(1),
  gatewayKey: z.string().min(1),
  gatewayUrl: z.url(),
  /** Decrypts the connection secrets the hub stores. */
  secretsKey: z
    .string()
    .transform((s) => Buffer.from(s, "base64"))
    .refine(
      (b) => b.length === 32,
      "AGENT_SECRETS_KEY must be 32 bytes, base64",
    ),
  dataDir: z.string().min(1),
});
export type Config = z.output<typeof config>;

/** Reads the worker's settings from `env`; throws a message naming each bad one. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = config.safeParse({
    apiUrl: env.API_URL,
    workerToken: env.AGENT_WORKER_TOKEN,
    gatewayKey: env.AI_GATEWAY_API_KEY,
    gatewayUrl:
      env.AGENT_GATEWAY_URL || "https://ai-gateway.vercel.sh/claude-code",
    secretsKey: env.AGENT_SECRETS_KEY,
    dataDir: env.AGENT_DATA_DIR || "/var/lib/dlh-agent",
  });
  if (!parsed.success) {
    const bad = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid agent worker config: ${bad}`);
  }
  return parsed.data;
}
