import { canonical } from "./hash";

/**
 * What a coworker-audience run may call without your approval. One rule for
 * both sides: the agent module's run guard enforces it, and the runner asks
 * you first for anything it doesn't allow, so the two can't disagree. A
 * subpath of its own (`@dlh/core/audience`) because it builds on `./hash`.
 */

/** Operations a coworker-audience run may always call: filing a request, and replying where it was asked. */
const ALWAYS = new Set(["requests.file", "slack.postToSource"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `input[key]`, if the input is an object. */
function field(input: unknown, key: string): unknown {
  return input && typeof input === "object" && key in input
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Whether `op` is `requests.file` with an input that claims where the request
 * came from: your own message (`fromOwner`), a source other than the agent,
 * or a source's sender or message id. Such a request reads as a message from
 * you (in Slack, a full-reach handoff), so no run may file one: the agent's
 * run guard refuses it for every run, and a coworker-audience run doesn't get
 * it alone.
 */
export function filesAsSource(op: { id: string }, input: unknown): boolean {
  if (op.id !== "requests.file") return false;
  const source = field(input, "source");
  return (
    field(input, "fromOwner") === true ||
    (source !== undefined && source !== "agent") ||
    field(input, "sourceHandle") !== undefined ||
    field(input, "externalId") !== undefined
  );
}

/** Every id-shaped string anywhere in `value`. */
function idsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (UUID.test(value)) out.push(value);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) idsIn(v, out);
  }
  return out;
}

/** `input.asker`, if the input has one. */
function askerOf(input: unknown): unknown {
  return input && typeof input === "object" && "asker" in input
    ? input.asker
    : undefined;
}

/** The operation's subject for `input`; none if it can't tell. */
function subjectOf(
  subject: (input: never) => string | null,
  input: unknown,
): string | null {
  try {
    return subject(input as never);
  } catch {
    return null;
  }
}

/** What the rule needs of an operation's description. */
export type AudienceOperation = {
  id: string;
  audience?: "asker";
  subject(input: never): string | null;
};

/** The run: its audience's asker, and the task and request it was given. */
export type AudienceRun = {
  asker: unknown;
  taskId: string;
  requestId: string | null;
};

/**
 * Whether a coworker-audience run may call `op` with `input` on its own:
 * - an `audience: "asker"` operation for its own asker, the whole asker
 *   (Slack id and GitHub login) alike;
 * - an operation whose subject is its own task or request and whose input
 *   names no other item (as `tasks.addParent` would, moving another task under
 *   its own; this also decides what the operation's `w.call`s reach);
 * - `requests.file` that doesn't file as a source (`filesAsSource`), and
 *   `slack.postToSource`.
 * Anything else needs your approval.
 */
export function audienceAllows(
  op: AudienceOperation,
  input: unknown,
  run: AudienceRun,
): boolean {
  if (
    op.audience === "asker" &&
    canonical(askerOf(input)) === canonical(run.asker)
  ) {
    return true;
  }
  const own = new Set([run.taskId, run.requestId].filter((x) => x !== null));
  const subject = subjectOf(op.subject, input);
  if (
    subject !== null &&
    own.has(subject) &&
    idsIn(input).every((x) => own.has(x))
  ) {
    return true;
  }
  return ALWAYS.has(op.id) && !filesAsSource(op, input);
}
