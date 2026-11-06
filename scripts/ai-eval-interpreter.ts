import { globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serverModules } from "../apps/api/src/modules.gen";
import {
  type Phrasing,
  runInterpreterSuite,
} from "../packages/core/src/ai/suite";
import {
  coreAiActions,
  interpreterId,
  interpreters,
} from "../packages/core/src/index";
import { corePhrasings } from "../packages/core/test/ai-phrasings";
import { moduleAiActions } from "../packages/server/src/modules";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PASS_THRESHOLD = 0.9;

type Miss = Awaited<ReturnType<typeof runInterpreterSuite>>["misses"][number];

/** `modules/<id>/test/ai-phrasings.ts` files, absolute paths. May be empty. */
export function collectPhrasingFiles(): string[] {
  return globSync("modules/*/test/ai-phrasings.ts", { cwd: ROOT })
    .sort()
    .map((f) => join(ROOT, f));
}

export const NO_PHRASINGS_MESSAGE =
  "No phrasings loaded — check packages/core/test/ai-phrasings.ts";

export function formatMiss({ phrasing, got }: Miss): string {
  return `expected ${phrasing.actionId}/${phrasing.kind}, got ${got.actionId}/${got.kind}: "${phrasing.text}"`;
}

/** Core phrasings plus every export named `*Phrasings` from each module file. */
async function loadPhrasings(files: string[]): Promise<Phrasing[]> {
  // Test hook: simulates broken phrasings imports, Core's and the modules'.
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: script-only, not a turbo input
  if (process.env.AI_EVAL_EMPTY) return [];
  const all = [...corePhrasings];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<
      string,
      unknown
    >;
    for (const [name, value] of Object.entries(mod)) {
      if (name.endsWith("Phrasings") && Array.isArray(value)) {
        all.push(...(value as Phrasing[]));
      }
    }
  }
  return all;
}

/** `--suite=slack-coworker`: the Slack bot's Jev interpreter, live through the Gateway. */
async function runSlackCoworkerSuite(): Promise<void> {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: a secret, not a turbo input
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error("The slack-coworker suite needs AI_GATEWAY_API_KEY.");
    process.exit(2);
  }
  const { createVercelGateway } = await import("../packages/server/src/index");
  const { freshTestDb, testDeps } = await import(
    "../packages/server/src/testing"
  );
  const { DEFAULT_INTERPRETER } = await import("../modules/slack/src/schema");
  const { coworkerPhrasings } = await import(
    "../modules/slack/test/coworker-phrasings"
  );
  const { runCoworkerSuite } = await import(
    "../modules/slack/test/coworker-suite"
  );
  const model =
    process.argv
      .find((a) => a.startsWith("--model="))
      ?.slice("--model=".length) ?? DEFAULT_INTERPRETER;
  const { db, close } = await freshTestDb();
  try {
    const deps = testDeps(db, {
      ai: { providers: { vercel: createVercelGateway({ apiKey }) } },
    });
    const { accuracy, misses } = await runCoworkerSuite(
      deps,
      coworkerPhrasings,
      model,
    );
    console.log(
      `Suite: slack-coworker; model ${model}; ${coworkerPhrasings.length} phrasings`,
    );
    for (const m of misses) {
      console.log(
        `  expected ${m.phrasing.expected}, got ${m.got}: "${m.phrasing.text}"`,
      );
    }
    console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
    if (accuracy < PASS_THRESHOLD) process.exitCode = 1;
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--suite=slack-coworker")) {
    return runSlackCoworkerSuite();
  }
  const arg = process.argv.find((a) => a.startsWith("--interpreter="));
  const which = interpreterId.safeParse(
    arg?.slice("--interpreter=".length) ?? "keywords",
  );
  if (!which.success) {
    console.error(
      `Unknown interpreter. Supported: ${Object.keys(interpreters).join(", ")}`,
    );
    process.exit(2);
  }
  const { interpreter } = interpreters[which.data];
  // Actions: Core's plus every server module's, operations included.
  const actions = [
    ...Object.values(coreAiActions),
    ...serverModules.flatMap((m) => moduleAiActions(m)),
  ];
  const phrasings = await loadPhrasings(collectPhrasingFiles());

  if (phrasings.length === 0) {
    console.error(NO_PHRASINGS_MESSAGE);
    process.exit(1);
  }

  const started = performance.now();
  const { accuracy, misses } = await runInterpreterSuite(
    interpreter,
    actions,
    phrasings,
  );
  const elapsed = performance.now() - started;

  // Median time per guess, measured one phrasing at a time.
  const times: number[] = [];
  for (const p of phrasings) {
    const t = performance.now();
    await runInterpreterSuite(interpreter, actions, [p]);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;

  console.log(`Interpreter: ${which.data}; ${phrasings.length} phrasings`);
  for (const m of misses) console.log(`  ${formatMiss(m)}`);
  console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(
    `Median ${median.toFixed(3)} ms per guess (suite ${elapsed.toFixed(1)} ms)`,
  );
  if (accuracy < PASS_THRESHOLD) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
