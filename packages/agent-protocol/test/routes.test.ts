import { describe, expect, it } from "vitest";
import {
  approvalAsk,
  credentialsResponse,
  eventsRequest,
  failRequest,
  finishRequest,
  hubRequest,
  hubResponse,
  inputHash,
  messagesResponse,
  runStart,
  sessionRequest,
  suspendRequest,
  suspendResponse,
} from "../src";

const examples: [string, import("zod").ZodType, unknown][] = [
  [
    "events",
    eventsRequest,
    {
      events: [
        { at: "2026-11-05T10:00:00.000Z", kind: "text", data: { a: 1 } },
      ],
    },
  ],
  ["messages", messagesResponse, { messages: [{ id: "m1", body: "hi" }] }],
  [
    "run",
    runStart,
    {
      runId: "r1",
      task: { id: "t1", title: "Do it", notes: null },
      request: { sender: null, body: "b", source: "email", sourceUrl: null },
      instructions: "be nice",
      connections: [
        { id: "c1", name: "gh", type: "github", scopeSummary: "repo" },
      ],
      grantedIds: ["c1"],
      sessionId: null,
      decision: { seq: 3, approve: true, delivered: false },
      lastSeq: 7,
    },
  ],
  ["hub request", hubRequest, { operation: "tasks.list", input: {} }],
  ["hub ok", hubResponse, { ok: true, result: [1] }],
  ["hub error", hubResponse, { ok: false, code: "FORBIDDEN", message: "no" }],
  ["credentials", credentialsResponse, { secret: { token: "x" } }],
  [
    "suspend",
    suspendRequest,
    {
      sessionId: "s",
      kind: "approval",
      tool: "Bash",
      input: { command: "ls" },
    },
  ],
  [
    "suspend grant",
    suspendRequest,
    { sessionId: "s", kind: "grant", connectionId: "c1", reason: "to file it" },
  ],
  ["suspend response", suspendResponse, { seq: 4 }],
  [
    "finish",
    finishRequest,
    { report: { summary: "done", links: [], filesChanged: [] } },
  ],
  ["fail", failRequest, { code: "boom", message: "it broke" }],
  ["session", sessionRequest, { sessionId: "s1" }],
];

describe("socket routes", () => {
  it.each(examples)(
    "%s schema parses its example and refuses extra fields",
    (_n, schema, example) => {
      expect(schema.safeParse(example).success).toBe(true);
      expect(
        schema.safeParse({ ...(example as object), extra: 1 }).success,
      ).toBe(false);
    },
  );
});

describe("suspend", () => {
  it("an approval carries the tool and its input, never a title or hash", () => {
    // The worker words the ask and hashes it from the input, so what the
    // owner reads is what gets allowed.
    const forged = {
      sessionId: "s",
      kind: "approval",
      tool: "Bash",
      input: { command: "git push origin HEAD:main" },
      title: "Approve: Bash: ls",
      body: "Bash: ls",
    };
    expect(suspendRequest.safeParse(forged).success).toBe(false);
    const { title: _t, body: _b, ...asked } = forged;
    expect(suspendRequest.safeParse({ ...asked, inputHash: "h" }).success).toBe(
      false,
    );
    expect(suspendRequest.safeParse(asked).success).toBe(true);
  });

  it("a grant names its connection and gives a reason", () => {
    expect(
      suspendRequest.safeParse({
        sessionId: "s",
        kind: "grant",
        connectionId: "c1",
        reason: "r",
        title: "Grant gh",
      }).success,
    ).toBe(false);
    expect(
      suspendRequest.safeParse({ sessionId: "s", kind: "grant", reason: "r" })
        .success,
    ).toBe(false);
  });
});

describe("approvalAsk", () => {
  it("hashes the tool and its input, whatever the key order", () => {
    expect(inputHash("Other", { a: 1, b: { c: 2, d: 3 } })).toBe(
      inputHash("Other", { b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(inputHash("Other", { a: 1 })).not.toBe(inputHash("Other", { a: 2 }));
    expect(inputHash("Other", { a: 1 })).not.toBe(inputHash("Else", { a: 1 }));
    expect(inputHash("Bash", { command: "x" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a Bash call hashes on its command alone, whatever its description", () => {
    const asked = {
      command: "gh pr merge 3",
      description: "Merge",
      timeout: 6,
    };
    const again = { command: "gh pr merge 3", description: "Merge PR #3" };
    expect(inputHash("Bash", again)).toBe(inputHash("Bash", asked));
    expect(inputHash("Bash", { ...again, run_in_background: true })).not.toBe(
      inputHash("Bash", asked),
    );
  });

  it("the same input hashes the same after a trip through JSON", () => {
    // The runner hashes the SDK's object; the worker hashes what the socket parsed.
    const input = { b: [1, { y: null, x: "é" }], a: undefined, c: -0 };
    expect(inputHash("T", JSON.parse(JSON.stringify(input)))).toBe(
      inputHash("T", input),
    );
  });

  it("words the ask from the input it hashes", () => {
    const input = { command: "gh pr merge 3", description: "harmless" };
    expect(approvalAsk("Bash", input)).toEqual({
      title: "Approve: Bash: gh pr merge 3",
      body: "Bash: gh pr merge 3",
      action: "Bash: gh pr merge 3",
      inputHash: inputHash("Bash", input),
    });
    expect(approvalAsk("mcp__x__create", { b: 1, a: "x" }).action).toBe(
      'mcp__x__create: {"a":"x","b":1}',
    );
  });

  it("a long action is quoted to 500 characters and given in full in the body", () => {
    const command = `echo ${"x".repeat(600)} && gh pr merge 3`;
    const ask = approvalAsk("Bash", { command });
    expect(ask.action).toHaveLength(500);
    expect(ask.action.endsWith("…")).toBe(true);
    expect(ask.title.length).toBeLessThanOrEqual(130);
    expect(ask.body).toContain(`Bash: ${command}`);
  });
});
