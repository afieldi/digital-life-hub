import { z } from "zod";
import {
  canonical,
  hubCallHash,
  hubToolName,
  inputHash,
  isHubTool,
} from "../src/hash";

describe("hash", () => {
  test("inputHash is unchanged by the move", () => {
    // Computed with agent-protocol's inputHash before it moved to Core.
    expect(
      inputHash("mcp__dlh__hub__requests_fromSender", {
        asker: { slackUserId: "U1", githubLogin: null },
        openOnly: true,
        skip: undefined,
        list: [2, { b: 1, a: "x" }],
      }),
    ).toBe("745b17e102a177c4bbcff7063414549e4e3f67777d24b5ab708a863c3b04b3a0");
    expect(
      inputHash("Bash", {
        command: "gh pr merge 4",
        description: "merge",
        timeout: 5,
      }),
    ).toBe("516a5f3edb57452ce3ea7936394da6e190d15de24462f14889817db21dec918e");
  });

  test("canonical sorts keys and drops undefined", () => {
    expect(canonical({ b: 1, a: [{ d: undefined, c: null }] })).toBe(
      '{"a":[{"c":null}],"b":1}',
    );
  });

  test("canonical writes a Date as its ISO string", () => {
    const at = "2026-11-02T17:00:00.000Z";
    expect(canonical(new Date(at))).toBe(`"${at}"`);
    expect(canonical({ since: new Date(at), b: [new Date(at)] })).toBe(
      `{"b":["${at}"],"since":"${at}"}`,
    );
    // A Date parsed by the hub hashes as the string the runner sent.
    expect(inputHash("mcp__dlh__hub__x_y", { since: new Date(at) })).toBe(
      inputHash("mcp__dlh__hub__x_y", { since: at }),
    );
  });

  test("hubToolName is the runner's MCP name of an operation", () => {
    expect(hubToolName("requests.fromSender")).toBe(
      "mcp__dlh__hub__requests_fromSender",
    );
    expect(isHubTool(hubToolName("requests.fromSender"))).toBe(true);
    expect(isHubTool("Bash")).toBe(false);
    expect(isHubTool("mcp__dlh__finish_task")).toBe(false);
  });

  test("hubCallHash hashes the input as the operation parses it", () => {
    const op = {
      id: "x.search",
      input: z.object({ text: z.string(), limit: z.number().default(10) }),
    };
    const tool = "mcp__dlh__hub__x_search";
    const parsed = { text: "a", limit: 10 };
    // The model's raw input (a default left out, an unknown key added) and
    // the API's parsed input hash the same.
    expect(hubCallHash(op, { text: "a" })).toBe(inputHash(tool, parsed));
    expect(hubCallHash(op, { text: "a", extra: 1 })).toBe(
      inputHash(tool, parsed),
    );
    expect(hubCallHash(op, parsed)).toBe(inputHash(tool, parsed));
    expect(hubCallHash(op, { text: "a", limit: 5 })).not.toBe(
      inputHash(tool, parsed),
    );
  });
});
