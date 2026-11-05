import { z } from "zod";

const cliConfig = z.object({
  apiUrl: z.url(),
  workerToken: z.string().min(1),
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
const config = cliConfig.extend({
  gatewayKey: z.string().min(1),
  gatewayUrl: z.url(),
  /** The run container's image; Task 9 builds `dlh-agent-runner`. */
  image: z.string().min(1),
});
export type Config = z.output<typeof config>;
/** What the connection CLI needs: no Gateway key. */
export type CliConfig = z.output<typeof cliConfig>;

function fail(error: z.ZodError): never {
  const bad = error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  throw new Error(`Invalid agent worker config: ${bad}`);
}

/** Reads the CLI's settings from `env`: the API, the secrets key and the data dir. */
export function loadCliConfig(
  env: Record<string, string | undefined>,
): CliConfig {
  const parsed = cliConfig.safeParse({
    apiUrl: env.API_URL,
    workerToken: env.AGENT_WORKER_TOKEN,
    secretsKey: env.AGENT_SECRETS_KEY,
    dataDir: env.AGENT_DATA_DIR || "/var/lib/dlh-agent",
  });
  return parsed.success ? parsed.data : fail(parsed.error);
}

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
    image: env.AGENT_RUNNER_IMAGE || "dlh-agent-runner",
  });
  if (!parsed.success) fail(parsed.error);
  return parsed.data;
}
