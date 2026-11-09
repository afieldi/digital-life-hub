import { createHash } from "node:crypto";
import type { z } from "zod";

/**
 * How an approval is matched: the runner and the worker hash a tool call the
 * same way, and so does an agent-module run guard re-checking a hub call, so
 * what the owner approved is exactly what gets allowed. A subpath of its own
 * (`@dlh/core/hash`) because it needs `node:crypto`, which the app can't load.
 */

/** JSON with every object's keys sorted, so equal inputs hash equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The part of a tool's input that says what it does. A model re-issuing an
 * approved Bash call words its `description` (and may pick a `timeout`)
 * anew, so only the command and whether it runs in the background count.
 */
function whatItDoes(tool: string, input: unknown): unknown {
  if (tool !== "Bash" || !input || typeof input !== "object") return input;
  const { command, run_in_background } = input as Record<string, unknown>;
  return {
    command,
    ...(run_in_background === true ? { run_in_background } : {}),
  };
}

/** sha256 of the tool's name and what its input does, as canonical JSON. */
export function inputHash(tool: string, input: unknown): string {
  return createHash("sha256")
    .update(`${tool}\n${canonical(whatItDoes(tool, input))}`)
    .digest("hex");
}

/** The prefix of every hub tool's name (`hubToolName`). */
const HUB_TOOL = "mcp__dlh__hub__";

/** Whether `tool` is a hub tool: an agent run calling a hub operation. */
export function isHubTool(tool: string): boolean {
  return tool.startsWith(HUB_TOOL);
}

/**
 * The tool name an agent run calls operation `<module>.<key>` by: the
 * runner's MCP server `dlh`, tool `hub__<module>_<key>`.
 */
export function hubToolName(operationId: string): string {
  const dot = operationId.indexOf(".");
  return `${HUB_TOOL}${operationId.slice(0, dot)}_${operationId.slice(dot + 1)}`;
}

/**
 * A hub call's input as its operation's schema parses it: defaults filled
 * and unknown keys dropped. Input the schema refuses is left as sent (the
 * hub refuses that call anyway).
 */
export function hubCallInput(
  op: { input: z.ZodType },
  input: unknown,
): unknown {
  const parsed = op.input.safeParse(input);
  return parsed.success ? parsed.data : input;
}

/**
 * The hash of a call to operation `op` as a hub tool. The runner hashes the
 * model's input and a run guard the hub's already parsed copy; parsing both
 * through the operation's schema makes them agree.
 */
export function hubCallHash(
  op: { id: string; input: z.ZodType },
  input: unknown,
): string {
  return inputHash(hubToolName(op.id), hubCallInput(op, input));
}
