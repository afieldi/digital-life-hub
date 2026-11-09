import { canonical, hubToolName, inputHash } from "../src/hash";

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

  test("hubToolName is the runner's MCP name of an operation", () => {
    expect(hubToolName("requests.fromSender")).toBe(
      "mcp__dlh__hub__requests_fromSender",
    );
  });
});
