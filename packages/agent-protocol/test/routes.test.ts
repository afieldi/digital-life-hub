import { describe, expect, it } from "vitest";
import {
  credentialsResponse,
  eventsRequest,
  failRequest,
  finishRequest,
  hubRequest,
  hubResponse,
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
      title: "t",
      body: "b",
      tool: "Bash",
      inputHash: "h",
      connectionId: "c1",
    },
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
