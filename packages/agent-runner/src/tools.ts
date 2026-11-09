import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type createSdkMcpServer,
  type SdkMcpToolDefinition,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { RunStart } from "@dlh/agent-protocol";
import { moduleDescriptions } from "@dlh/agent-protocol/modules";
import { accessOf, type OperationDescription } from "@dlh/core";
import { z } from "zod";
import type { RunControl } from "./control";
import type { Host } from "./host";

const run = promisify(execFile);

/** What `createSdkMcpServer` takes: tools with any input shape. */
type RunnerTools = NonNullable<
  Parameters<typeof createSdkMcpServer>[0]["tools"]
>;
type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

const text = (t: string): CallToolResult => ({
  content: [{ type: "text", text: t }],
});
const error = (t: string): CallToolResult => ({ ...text(t), isError: true });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type HubOperation = {
  /** `hub__<module>_<key>`. */
  name: string;
  /** `<module>.<key>`. */
  id: string;
  description: string;
  input: OperationDescription["input"];
  /** `asker` for an operation that answers for one person. */
  audience: OperationDescription["audience"];
  subject: OperationDescription["subject"];
  /** Whether its input names a run, which the worker fills with this one. */
  takesRunId: boolean;
};

/**
 * The hub operations a run may call: every operation of the module
 * descriptions whose access is `everyone` (D6). An `ai: false` operation is
 * `user` unless it says otherwise, and one that does is left out too, unless
 * it is `hub: true` (a tool for runs only).
 */
export function hubOperations(): HubOperation[] {
  return moduleDescriptions.flatMap((m) =>
    Object.entries(m.operations as Record<string, OperationDescription>)
      .filter(
        ([, op]) =>
          accessOf(op) === "everyone" && (op.ai !== false || op.hub === true),
      )
      .map(([key, op]) => ({
        name: `hub__${m.id}_${key}`,
        id: op.id,
        description: op.description,
        input: op.input,
        audience: op.audience,
        subject: op.subject,
        takesRunId: "runId" in op.input.shape,
      })),
  );
}

/** The input the model gives a hub tool: the operation's, but for a runId. */
function modelShape(op: HubOperation): OperationDescription["input"]["shape"] {
  if (!op.takesRunId) return op.input.shape;
  const { runId: _, ...rest } = op.input.shape;
  return rest;
}

/**
 * Files changed in each git repository directly under the workspace, from
 * `git status --porcelain`, as `<repo>/<path>`.
 */
export async function filesChanged(workspace: string): Promise<string[]> {
  const repos = readdirSync(workspace, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(workspace, d.name, ".git")),
    )
    .map((d) => d.name)
    .sort();
  const out: string[] = [];
  for (const repo of repos) {
    const { stdout } = await run(
      "git",
      [
        "-C",
        join(workspace, repo),
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=all",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    // `-z`: `XY path\0`, with a rename's old path as the next entry.
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] ?? "";
      if (e.length < 4) continue;
      out.push(`${repo}/${e.slice(3)}`);
      if (e[0] === "R" || e[0] === "C") i++;
    }
  }
  return out;
}

/**
 * The runner's MCP tools: one per hub operation a run may call, plus
 * `finish_task`, `give_up` and `request_connection`, which end the session.
 */
export function createTools(deps: {
  host: Host;
  start: RunStart;
  workspace: string;
  control: RunControl;
}): RunnerTools {
  const { host, control } = deps;

  const hub = hubOperations().map((op) =>
    // The model isn't asked for a runId: the worker fills in the run's own.
    tool(op.name, op.description, modelShape(op), async (input) => {
      try {
        const r = await host.hub({ operation: op.id, input });
        return r.ok
          ? text(JSON.stringify(r.result ?? null))
          : error(`${r.code}: ${r.message}`);
      } catch (e) {
        return error(`The hub call failed: ${message(e)}`);
      }
    }),
  );

  const finish = tool(
    "finish_task",
    "Ends the run with a report when the task is done: a short summary and links (PRs, docs). The files changed are added for you.",
    {
      summary: z.string().min(1).describe("What you did, in a few sentences"),
      links: z
        .array(z.object({ label: z.string(), url: z.string() }))
        .default([])
        .describe("Links to what you made, such as pull requests"),
    },
    async ({ summary, links }) => {
      try {
        const files = await filesChanged(deps.workspace);
        await control.finish({ summary, links, filesChanged: files });
        return text("Reported. The run is done.");
      } catch (e) {
        return error(`Couldn't report: ${message(e)}`);
      }
    },
  );

  const giveUp = tool(
    "give_up",
    "Ends the run as stuck, when you can't finish the task. The owner sees the reason and can retry.",
    { reason: z.string().min(1).describe("Why you can't go on") },
    async ({ reason }) => {
      try {
        await control.fail("stuck", reason);
        return text("Reported. The run has ended.");
      } catch (e) {
        return error(`Couldn't report: ${message(e)}`);
      }
    },
  );

  const requestConnection = tool(
    "request_connection",
    "Asks the owner for a connection you don't have, by its name. The run pauses until they answer; you're told whether it was granted.",
    {
      name: z.string().min(1).describe("The connection's name, as listed"),
      reason: z.string().min(1).describe("What you need it for"),
    },
    async ({ name, reason }) => {
      const c = deps.start.connections.find((x) => x.name === name);
      if (!c) return error(`No connection is named "${name}".`);
      if (deps.start.grantedIds.includes(c.id)) {
        return error(`You already have "${name}".`);
      }
      const action = `Grant ${c.name} (${c.type}): ${reason}`.slice(0, 500);
      try {
        await control.suspend({
          kind: "grant",
          connectionId: c.id,
          reason,
          connectionName: c.name,
          action,
        });
        return text("Asked the owner. The run pauses until they answer.");
      } catch (e) {
        return error(`Couldn't ask: ${message(e)}`);
      }
    },
  );

  return [...hub, finish, giveUp, requestConnection];
}
