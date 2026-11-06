import { createHash } from "node:crypto";

/**
 * How an approval is worded and matched, shared by the runner (which matches
 * a tool call against an approval) and the worker (which words the ask and
 * hashes it from the same input), so what the owner reads is always what
 * gets allowed.
 */

/** JSON with every object's keys sorted, so equal inputs hash equal. */
function canonical(value: unknown): string {
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

const MAX_ACTION = 500;
const MAX_TITLE_ACTION = 120;

const short = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** The tool and what its input does, in full: a Bash call's command, else the input. */
function fullAction(tool: string, input: Record<string, unknown>): string {
  const what =
    tool === "Bash" && typeof input.command === "string"
      ? input.command
      : canonical(input);
  return `${tool}: ${what}`;
}

/** The action quoted to the owner: the tool and its input, at most 500 characters. */
export function describeAction(
  tool: string,
  input: Record<string, unknown>,
): string {
  return short(fullAction(tool, input), MAX_ACTION);
}

/** An approval request as the owner reads it, and the hash it allows. */
export type ApprovalAsk = {
  title: string;
  /** The action in full, so a quote cut at 500 characters hides nothing. */
  body: string;
  /** The action quoted, at most 500 characters. */
  action: string;
  inputHash: string;
};

/** Words an approval request from the input it hashes. */
export function approvalAsk(
  tool: string,
  input: Record<string, unknown>,
): ApprovalAsk {
  const action = describeAction(tool, input);
  return {
    title: `Approve: ${short(action, MAX_TITLE_ACTION)}`,
    body: fullAction(tool, input),
    action,
    inputHash: inputHash(tool, input),
  };
}
