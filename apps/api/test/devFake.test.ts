import { devFakeAi } from "@dlh/server";
import { z } from "zod";
import { composed } from "../src/router";

// e2e and `pnpm dev` with AI_FAKE_PROVIDER=1 answer every action with the
// scripted fake: each runner's every kind must get an answer its own output
// schema accepts, or the action fails there. A runner whose output the fake
// can't guess from its shape gives one through `devFake`.

const fake = devFakeAi(composed.aiRunners.values()).providers.openrouter;
const ids = Array.from(
  { length: 3 },
  (_, n) => `0197a000-0000-7000-8000-00000000000${n}`,
);
// Some runners read ids from the prompt (Plan today lists tasks by id).
const prompt = `Today is Mon, Nov 2, 2026, 9:00 (UTC).
<item>
${ids.map((id, n) => `- Task ${n} (id ${id})`).join("\n")}
</item>`;

const cases = [...composed.aiRunners.values()].flatMap((runner) =>
  Object.entries(runner.output).map(
    ([kind, schema]) =>
      [`${runner.action.id} ${kind}`, runner, schema] as const,
  ),
);

test.each(cases)(
  "%s: the fake's answer fits the output",
  async (_, runner, schema) => {
    if (!schema) return;
    const { raw } = await fake.complete({
      system: `${runner.system}\n(data line)`,
      prompt,
      schema: z.toJSONSchema(schema) as object,
      model: "fake-model",
      signal: new AbortController().signal,
    });
    const parsed = schema.safeParse(JSON.parse(raw));
    expect(parsed.success, parsed.error?.message).toBe(true);
  },
);
