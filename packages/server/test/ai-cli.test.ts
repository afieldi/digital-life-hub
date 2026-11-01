import { AiError } from "../src/ai/errors";
import { unwrapCliOutput } from "../src/ai/providers/cli";

function errOf(fn: () => unknown): AiError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error("expected throw");
}

const env = (o: Record<string, unknown>) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, ...o });

describe("unwrapCliOutput claude-cli", () => {
  test("prefers structured_output", () => {
    const out = unwrapCliOutput(
      "claude-cli",
      env({ result: "text", structured_output: { a: 1 } }),
    );
    expect(out).toBe('{"a":1}');
  });

  test("falls back to result", () => {
    expect(unwrapCliOutput("claude-cli", env({ result: '{"a":2}' }))).toBe(
      '{"a":2}',
    );
  });

  test("real auth-failure envelope is provider_unavailable signed_out", () => {
    const stdout =
      '{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed","num_turns":1,"total_cost_usd":0,"session_id":"069954d9-ce3e-44db-94a9-850fc0d0be07"}';
    const e = errOf(() => unwrapCliOutput("claude-cli", stdout));
    expect(e.code).toBe("provider_unavailable");
    expect(e.message).toBe(
      "Claude Code isn't signed in. Run `claude` once in a terminal to sign in.",
    );
  });

  test("other is_error envelope is provider_error with first line", () => {
    const e = errOf(() =>
      unwrapCliOutput(
        "claude-cli",
        env({ is_error: true, result: "Rate limited\nretry later" }),
      ),
    );
    expect(e.code).toBe("provider_error");
    expect(e.message).toBe("Claude Code returned an error: Rate limited.");
  });

  test("non-JSON stdout is bad_output", () => {
    expect(errOf(() => unwrapCliOutput("claude-cli", "hello there")).code).toBe(
      "bad_output",
    );
  });

  test("envelope with neither structured_output nor string result is bad_output", () => {
    expect(errOf(() => unwrapCliOutput("claude-cli", env({}))).code).toBe(
      "bad_output",
    );
    expect(errOf(() => unwrapCliOutput("claude-cli", "[1]")).code).toBe(
      "bad_output",
    );
  });
});

describe("unwrapCliOutput codex-cli", () => {
  test("returns the last message trimmed", () => {
    expect(unwrapCliOutput("codex-cli", '\n{"a":1}\n  ')).toBe('{"a":1}');
  });

  test("empty output is bad_output", () => {
    expect(errOf(() => unwrapCliOutput("codex-cli", "  \n")).code).toBe(
      "bad_output",
    );
  });
});
