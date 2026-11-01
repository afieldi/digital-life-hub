import { globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serverModules } from "../apps/api/src/modules.gen";
import {
  type Phrasing,
  runInterpreterSuite,
} from "../packages/core/src/ai/suite";
import { coreAiActions, keywordInterpreter } from "../packages/core/src/index";
import { corePhrasings } from "../packages/core/test/ai-phrasings";

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
  // Test hook: simulates a broken phrasings import.
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: script-only, not a turbo input
  const all = process.env.AI_EVAL_EMPTY ? [] : [...corePhrasings];
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

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--interpreter="));
  const which = arg?.slice("--interpreter=".length) ?? "keywords";
  if (which !== "keywords") {
    console.error(`Unknown interpreter "${which}". Supported: keywords`);
    process.exit(2);
  }
  // Actions: Core's plus every server module's `aiActions`.
  const actions = [
    ...Object.values(coreAiActions),
    ...serverModules.flatMap((m) =>
      "aiActions" in m && m.aiActions ? m.aiActions : [],
    ),
  ];
  const phrasings = await loadPhrasings(collectPhrasingFiles());

  if (phrasings.length === 0) {
    console.error(NO_PHRASINGS_MESSAGE);
    process.exit(1);
  }

  const started = performance.now();
  const { accuracy, misses } = await runInterpreterSuite(
    keywordInterpreter,
    actions,
    phrasings,
  );
  const elapsed = performance.now() - started;

  // Median time per guess, measured one phrasing at a time.
  const times: number[] = [];
  for (const p of phrasings) {
    const t = performance.now();
    await runInterpreterSuite(keywordInterpreter, actions, [p]);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;

  console.log(`Interpreter: ${which}; ${phrasings.length} phrasings`);
  for (const m of misses) console.log(`  ${formatMiss(m)}`);
  console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(
    `Median ${median.toFixed(3)} ms per guess (suite ${elapsed.toFixed(1)} ms)`,
  );
  if (accuracy < PASS_THRESHOLD) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
