import { createVercelGateway } from "@dlh/server";
import { freshTestDb, testDeps } from "@dlh/server/testing";
import { expect, test } from "vitest";
import { DEFAULT_INTERPRETER } from "../src/schema";
import { coworkerPhrasings } from "./coworker-phrasings";
import { runCoworkerSuite } from "./coworker-suite";

// biome-ignore lint/style/noProcessEnv: the live suite runs only when the key is set
const apiKey = process.env.AI_GATEWAY_API_KEY;

test("the coworker phrasings are 40, covering every command", () => {
  expect(coworkerPhrasings).toHaveLength(40);
  expect(new Set(coworkerPhrasings.map((p) => p.expected))).toEqual(
    new Set([
      "leaveRequest",
      "addToRequest",
      "requestStatus",
      "withdraw",
      "askAbout",
      "escalate",
    ]),
  );
});

test.skipIf(!apiKey)(
  "the phrasings run at 90% or better against the Jev interpreter",
  async () => {
    const { db, close } = await freshTestDb();
    try {
      const deps = testDeps(db, {
        ai: {
          providers: { vercel: createVercelGateway({ apiKey: apiKey ?? "" }) },
        },
      });
      const { accuracy, misses } = await runCoworkerSuite(
        deps,
        coworkerPhrasings,
        DEFAULT_INTERPRETER,
      );
      for (const m of misses) {
        console.log(
          `expected ${m.phrasing.expected}, got ${m.got}: "${m.phrasing.text}"`,
        );
      }
      console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.9);
    } finally {
      await close();
    }
  },
  600_000,
);
