import { describe, expect, test } from "vitest";
import { expectAskerScoped } from "../../src/testing/asker";

type Asker = { slackUserId: string; githubLogin: string | null };

/** A store of rows per Slack user, and a query over it. */
function fixture(filter: boolean) {
  const rows: { owner: string; text: string }[] = [];
  return {
    seed: async (asker: Asker) => {
      rows.push({ owner: asker.slackUserId, text: "secret" });
    },
    call: async (_opId: string, input: unknown) => {
      const { asker } = input as { asker: Asker };
      return filter ? rows.filter((r) => r.owner === asker.slackUserId) : rows;
    },
  };
}

describe("expectAskerScoped", () => {
  test("passes for an operation that filters on the asker", async () => {
    const f = fixture(true);
    await expectAskerScoped(f.call, "fixture.mine", {}, f.seed);
  });
  test("fails for an operation that ignores the asker", async () => {
    const f = fixture(false);
    await expect(
      expectAskerScoped(f.call, "fixture.all", {}, f.seed),
    ).rejects.toThrow();
  });
  test("fails when the seed gives the asker nothing to see", async () => {
    const f = fixture(true);
    await expect(
      expectAskerScoped(f.call, "fixture.mine", {}, async () => {}),
    ).rejects.toThrow();
  });
  test("passes the other input along", async () => {
    const seen: unknown[] = [];
    const f = fixture(true);
    await expectAskerScoped(
      async (id, input) => {
        seen.push(input);
        return f.call(id, input);
      },
      "fixture.mine",
      { openOnly: true },
      f.seed,
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ openOnly: true });
  });
});
