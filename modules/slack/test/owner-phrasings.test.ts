import { createVercelGateway } from "@dlh/server";
import { expect, test } from "vitest";
import { DEFAULT_INTERPRETER } from "../src/schema";
import { ownerPhrasings } from "./owner-phrasings";
import { runOwnerSuite } from "./owner-suite";
import { setup } from "./setup";

// biome-ignore lint/style/noProcessEnv: the live suite runs only when the key is set
const apiKey = process.env.AI_GATEWAY_API_KEY;

test("the owner phrasings are 40, with 6 that should escalate", () => {
  expect(ownerPhrasings).toHaveLength(40);
  expect(ownerPhrasings.filter((p) => p.expected === "escalate")).toHaveLength(
    6,
  );
  expect(new Set(ownerPhrasings.map((p) => p.expected))).toContain(
    "slack.handOff|do",
  );
});

test.skipIf(!apiKey)(
  "the owner phrasings run at 85% or better",
  async () => {
    const s = await setup();
    try {
      s.deps.ai.providers.vercel = createVercelGateway({
        apiKey: apiKey ?? "",
      });
      const { accuracy, misses } = await runOwnerSuite(
        s,
        ownerPhrasings,
        DEFAULT_INTERPRETER,
      );
      for (const m of misses) {
        console.log(
          `expected ${m.phrasing.expected}, got ${m.got}: "${m.phrasing.text}"`,
        );
      }
      console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.85);
    } finally {
      await s.close();
    }
  },
  600_000,
);
