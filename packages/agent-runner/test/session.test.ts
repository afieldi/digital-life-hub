import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Host } from "../src/host";
import { inputHash } from "../src/permissions";
import { buildPrompt } from "../src/prompt";
import { type QueryFn, runSession } from "../src/session";
import { fakeHost, runStart } from "./fixtures";

const SESSION = "0b5e1f0e-6a8c-4f57-9f43-1d7b3c1a2e10";

let dir: string;
let configDir: string;
let workspace: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dlh-runner-session-"));
  configDir = join(dir, "config");
  workspace = join(dir, "workspace");
  mkdirSync(configDir);
  mkdirSync(workspace);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const assistant = (text: string) =>
  ({
    type: "assistant",
    session_id: SESSION,
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text }] },
  }) as unknown as SDKMessage;

const result = () =>
  ({
    type: "result",
    subtype: "success",
    session_id: SESSION,
  }) as unknown as SDKMessage;

const init = () =>
  ({
    type: "system",
    subtype: "init",
    session_id: SESSION,
  }) as unknown as SDKMessage;

const textOf = (m: SDKUserMessage) =>
  typeof m.message.content === "string" ? m.message.content : "";

/**
 * A fake SDK `query`: for each user message it reads from the input, it
 * yields what `turn` returns, then waits for the next one, ending with the
 * input as the real SDK does in streaming mode.
 */
function fakeQuery(
  turn: (
    message: SDKUserMessage,
    index: number,
    options: Options,
  ) => Promise<SDKMessage[]> | SDKMessage[],
) {
  const seen = {
    options: undefined as Options | undefined,
    inputs: [] as string[],
    interrupts: 0,
  };
  const query: QueryFn = ({ prompt, options }) => {
    seen.options = options;
    const messages = (async function* () {
      let i = 0;
      for await (const m of prompt) {
        seen.inputs.push(textOf(m));
        if (i === 0) yield init();
        yield* await turn(m, i++, options);
      }
    })();
    return Object.assign(messages, {
      interrupt: async () => {
        seen.interrupts++;
      },
    });
  };
  return { query, seen };
}

function deps(host: Host, query: QueryFn) {
  return {
    host,
    query,
    configDir,
    workspace,
    currentBranch: () => "feature",
    log: () => {},
  };
}

function writeSessionFile() {
  const project = join(configDir, "projects", "-workspace");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${SESSION}.jsonl`), "{}\n");
}

describe("runSession", () => {
  it("a run with a session resumes and sends the decision", async () => {
    writeSessionFile();
    const merge = { command: "gh pr merge 3 --squash" };
    mkdirSync(join(workspace, ".dlh"));
    writeFileSync(
      join(workspace, ".dlh", "pending.json"),
      JSON.stringify({
        seq: 7,
        kind: "approval",
        tool: "Bash",
        inputHash: inputHash("Bash", merge),
        action: "Bash: gh pr merge 3 --squash",
      }),
    );
    const { host, calls } = fakeHost();
    const decisions: string[] = [];
    const { query, seen } = fakeQuery(async (_m, _i, options) => {
      const signal = new AbortController().signal;
      const first = await options.canUseTool?.("Bash", merge, {
        signal,
        toolUseID: "t1",
        requestId: "r1",
      });
      decisions.push(first?.behavior ?? "none");
      return [assistant("Merged."), result()];
    });

    await runSession(
      runStart({
        sessionId: SESSION,
        decision: { seq: 7, approve: true, delivered: true },
      }),
      deps(host, query),
    );

    expect(seen.options?.resume).toBe(SESSION);
    expect(seen.inputs[0]).toBe(
      "Approved: Bash: gh pr merge 3 --squash. Go ahead.",
    );
    expect(decisions).toEqual(["allow"]);
    expect(calls.session).toEqual([SESSION]);
    expect(existsSync(join(workspace, ".dlh", "pending.json"))).toBe(false);
  });

  it("a declined grant resumes with Not granted", async () => {
    writeSessionFile();
    mkdirSync(join(workspace, ".dlh"));
    writeFileSync(
      join(workspace, ".dlh", "pending.json"),
      JSON.stringify({
        seq: 4,
        kind: "grant",
        connectionName: "Linear",
        action: "Grant Linear",
      }),
    );
    const { host } = fakeHost();
    const { query, seen } = fakeQuery(() => [result()]);
    await runSession(
      runStart({
        sessionId: SESSION,
        decision: { seq: 4, approve: false, delivered: true },
      }),
      deps(host, query),
    );
    expect(seen.inputs[0]).toBe("Not granted: Linear.");
  });

  it("a resume with no decision says Continue.", async () => {
    writeSessionFile();
    const { host } = fakeHost();
    const { query, seen } = fakeQuery(() => [result()]);
    await runSession(runStart({ sessionId: SESSION }), deps(host, query));
    expect(seen.options?.resume).toBe(SESSION);
    expect(seen.inputs[0]).toBe("Continue.");
  });

  it("a missing session file starts fresh with the prompt", async () => {
    const { host } = fakeHost();
    const { query, seen } = fakeQuery(() => [result()]);
    const start = runStart({ sessionId: SESSION });
    await runSession(start, deps(host, query));
    expect(seen.options?.resume).toBeUndefined();
    expect(seen.inputs[0]).toBe(buildPrompt(start));
  });

  it("no settings file can allow a tool: only canUseTool decides", async () => {
    const { host } = fakeHost();
    const { query, seen } = fakeQuery(() => [result()]);
    await runSession(runStart(), deps(host, query));
    expect(seen.options?.settingSources).toEqual([]);
    expect(seen.options?.permissionMode).toBe("default");
    expect(seen.options?.managedSettings).toBeUndefined();
    expect(typeof seen.options?.canUseTool).toBe("function");
  });

  it("connections' MCP servers and env reach the SDK, the runner's server kept", async () => {
    const { host } = fakeHost();
    const { query, seen } = fakeQuery(() => [result()]);
    const slack = { type: "stdio" as const, command: "node", args: ["x"] };
    await runSession(runStart(), {
      ...deps(host, query),
      env: { DEPLOY_KEY: "v", ANTHROPIC_API_KEY: "not-empty" },
      mcpServers: { Slack: slack, dlh: slack },
    });
    expect(seen.options?.mcpServers?.Slack).toEqual(slack);
    expect(seen.options?.mcpServers?.dlh).not.toEqual(slack);
    expect(seen.options?.env?.DEPLOY_KEY).toBe("v");
    expect(seen.options?.env?.ANTHROPIC_API_KEY).toBe("");
  });

  it("messages from the socket reach the session", async () => {
    const { host, calls } = fakeHost({
      inbox: [{ id: "m1", body: "Use the staging branch" }],
    });
    const { query, seen } = fakeQuery((_m, i) =>
      i === 0 ? [assistant("Looking.")] : [assistant("Okay."), result()],
    );
    await runSession(runStart(), deps(host, query));
    expect(seen.inputs).toEqual([
      buildPrompt(runStart()),
      "Use the staging branch",
    ]);
    const events = calls.events.flat();
    expect(events.map((e) => [e.kind, e.data.text])).toEqual([
      ["text", "Looking."],
      ["text", "Okay."],
      ["status", undefined],
    ]);
  });

  it('ending without a report fails "Ended without a report"', async () => {
    const { host, calls } = fakeHost();
    const { query } = fakeQuery(() => [assistant("All done!"), result()]);
    const outcome = await runSession(runStart(), deps(host, query));
    expect(calls.fail).toEqual([
      { code: "no_report", message: "Ended without a report" },
    ]);
    expect(outcome).toBe("no_report");
  });

  it("an ask writes pending.json, suspends and ends the session", async () => {
    const { host, calls } = fakeHost({ suspendSeq: 12 });
    const push = { command: "git push origin HEAD:main" };
    const { query } = fakeQuery(async (_m, _i, options) => {
      const signal = new AbortController().signal;
      const answer = await options.canUseTool?.("Bash", push, {
        signal,
        toolUseID: "t1",
        requestId: "r1",
      });
      expect(answer).toMatchObject({ behavior: "deny", interrupt: true });
      return [result()];
    });
    const outcome = await runSession(runStart(), deps(host, query));

    expect(outcome).toBe("suspended");
    expect(calls.fail).toEqual([]);
    expect(calls.suspend).toEqual([
      expect.objectContaining({
        sessionId: SESSION,
        kind: "approval",
        tool: "Bash",
        inputHash: inputHash("Bash", push),
      }),
    ]);
    expect(calls.suspend[0]?.body).toContain("git push origin HEAD:main");
    const pending = JSON.parse(
      readFileSync(join(workspace, ".dlh", "pending.json"), "utf8"),
    );
    expect(pending).toEqual({
      seq: 12,
      kind: "approval",
      tool: "Bash",
      inputHash: inputHash("Bash", push),
      action: "Bash: git push origin HEAD:main",
    });
    // Events sent before the suspend, the permission among them.
    expect(calls.events.flat().map((e) => e.kind)).toContain("permission");
  });

  it("a report interrupts the turn before the answer goes back", async () => {
    // A tool that reports (request_connection, finish_task) answers the SDK
    // after its report; the turn must stop there, not go on to the model.
    const { host } = fakeHost({ suspendSeq: 3 });
    const { query, seen } = fakeQuery(async (_m, _i, options) => {
      const signal = new AbortController().signal;
      await options.canUseTool?.(
        "Bash",
        { command: "gh pr merge 1" },
        { signal, toolUseID: "t1", requestId: "r1" },
      );
      expect(seen.interrupts).toBe(1);
      return [result()];
    });
    expect(await runSession(runStart(), deps(host, query))).toBe("suspended");
    expect(seen.interrupts).toBe(1);
  });
});
