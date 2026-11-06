import type { CoreDeps } from "@dlh/server";
import { coworkerCommands } from "../src/server/commands";
import { interpretMessage } from "../src/server/interpret";
import type { CoworkerPhrasing } from "./coworker-phrasings";

/** Runs each phrasing through `interpretMessage` with every coworker command. */
export async function runCoworkerSuite(
  deps: CoreDeps,
  phrasings: CoworkerPhrasing[],
  model: string,
) {
  const commands = Object.keys(
    coworkerCommands,
  ) as (keyof typeof coworkerCommands)[];
  const misses: { phrasing: CoworkerPhrasing; got: string }[] = [];
  for (const phrasing of phrasings) {
    const got = await interpretMessage(deps, {
      text: phrasing.text,
      context: phrasing.context,
      commands,
      model,
      timeoutMs: 10_000,
    });
    if (got.command !== phrasing.expected) {
      misses.push({ phrasing, got: `${got.command} (${got.confidence})` });
    }
  }
  return {
    accuracy: (phrasings.length - misses.length) / phrasings.length,
    misses,
  };
}
