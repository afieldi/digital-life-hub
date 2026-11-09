import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleDescriptions } from "@dlh/agent-protocol/modules";
import type { OperationDescription } from "@dlh/core";
import { hubToolName } from "@dlh/core/hash";
import { createControl } from "../src/control";
import { RUNNER_SERVER } from "../src/permissions";
import { createTools, hubOperations } from "../src/tools";
import { fakeHost, runStart } from "./fixtures";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dlh-runner-tools-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setUp() {
  const { host, calls } = fakeHost();
  const ended: string[] = [];
  const control = createControl({
    host,
    workspace: dir,
    sessionId: () => "session-1",
    events: { add() {}, drain: async () => {} },
    onEnd: (outcome) => {
      ended.push(outcome);
    },
  });
  const tools = createTools({
    host,
    start: runStart(),
    workspace: dir,
    control,
  });
  const byName = (name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };
  return { calls, ended, tools, byName };
}

describe("hub tools", () => {
  it("hubToolName matches the runner's tool names", () => {
    const ops = hubOperations();
    expect(ops.map((o) => o.id)).toContain("requests.fromSender");
    for (const op of ops) {
      expect(hubToolName(op.id)).toBe(`mcp__${RUNNER_SERVER}__${op.name}`);
    }
  });

  it("hub tools are only everyone-access operations", () => {
    const all = moduleDescriptions.flatMap(
      (m) => Object.values(m.operations) as OperationDescription[],
    );
    const names = hubOperations().map((o) => o.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("hub__tasks_create");
    expect(names.some((n) => n.startsWith("hub__agent_"))).toBe(false);
    for (const op of all.filter((o) => o.ai === false || o.access)) {
      if (op.access === "everyone" && op.ai !== false) continue;
      const [mod, key] = op.id.split(".");
      expect(names, op.id).not.toContain(`hub__${mod}_${key}`);
    }
  });

  it("a hub tool calls the operation through the socket", async () => {
    const { calls, byName } = setUp();
    const result = await byName("hub__tasks_create").handler(
      { title: "Buy milk" },
      {},
    );
    expect(calls.hub).toEqual([
      { operation: "tasks.create", input: { title: "Buy milk" } },
    ]);
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("tasks.create");
  });
});

describe("a hub tool with a runId", () => {
  it("doesn't ask the model for it: the worker fills it", async () => {
    const { calls, byName } = setUp();
    const post = byName("hub__slack_postToSource");
    expect(Object.keys(post.inputSchema)).toEqual(["text"]);
    await post.handler({ text: "On it" }, {});
    expect(calls.hub).toEqual([
      { operation: "slack.postToSource", input: { text: "On it" } },
    ]);
  });
});

describe("ending tools", () => {
  it("finish_task reports the files git sees changed", async () => {
    const repo = join(dir, "web");
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-qm", "init");
    writeFileSync(join(repo, "a.txt"), "two\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    // Not a repository: ignored.
    mkdirSync(join(dir, "notes"));
    writeFileSync(join(dir, "notes", "x.txt"), "x");

    const { calls, ended, byName } = setUp();
    await byName("finish_task").handler(
      { summary: "Fixed it", links: [{ label: "PR", url: "https://x/pr/1" }] },
      {},
    );
    expect(calls.finish).toEqual([
      {
        report: {
          summary: "Fixed it",
          links: [{ label: "PR", url: "https://x/pr/1" }],
          filesChanged: ["web/a.txt", "web/new.txt"],
        },
      },
    ]);
    expect(ended).toEqual(["finished"]);
  });

  it("give_up fails the run as stuck", async () => {
    const { calls, ended, byName } = setUp();
    await byName("give_up").handler({ reason: "No access to prod" }, {});
    expect(calls.fail).toEqual([
      { code: "stuck", message: "No access to prod" },
    ]);
    expect(ended).toEqual(["failed"]);
  });

  it("request_connection suspends with a grant request", async () => {
    const { calls, ended, byName } = setUp();
    await byName("request_connection").handler(
      { name: "Linear", reason: "To file the follow-up" },
      {},
    );
    expect(calls.suspend).toEqual([
      {
        sessionId: "session-1",
        kind: "grant",
        connectionId: "c3",
        reason: "To file the follow-up",
      },
    ]);
    expect(ended).toEqual(["suspended"]);
  });

  it("request_connection refuses an unknown or already granted name", async () => {
    const { calls, byName } = setUp();
    const unknown = await byName("request_connection").handler(
      { name: "Nope", reason: "x" },
      {},
    );
    const granted = await byName("request_connection").handler(
      { name: "Slack", reason: "x" },
      {},
    );
    expect(unknown.isError).toBe(true);
    expect(granted.isError).toBe(true);
    expect(calls.suspend).toEqual([]);
  });
});
