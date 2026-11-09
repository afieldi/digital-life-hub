import { canonical, hubCallHash, hubToolName } from "@dlh/core/hash";
import type { RunGuard } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { agentAssignments, agentRuns } from "../db/schema";

/** Operations a coworker-audience run may always call: filing a request, and replying where it was asked. */
const ALWAYS = new Set(["requests.file", "slack.postToSource"]);

const refuse = (message: string): never => {
  throw new TRPCError({ code: "FORBIDDEN", message });
};

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Keeps a coworker-audience run to what involves its coworker. Without an
 * audience a run is not limited here. With one, it may call:
 * an `audience: "asker"` operation for its own asker; an operation whose
 * subject is its own task or request and which names no other item (as
 * `tasks.addParent` would, moving another task under its own; this also
 * decides what the operation's `w.call`s reach, as they aren't guarded);
 * `requests.file` and
 * `slack.postToSource`. Anything else needs a hub approval you gave for that
 * exact call, which it spends. Fails closed: a run it can't find is refused.
 */
export const runGuard: RunGuard = async (deps, { runId, operation, input }) => {
  const [run] = await deps.db
    .select({
      taskId: agentRuns.taskId,
      audience: agentRuns.audience,
      requestId: agentAssignments.requestId,
    })
    .from(agentRuns)
    .leftJoin(agentAssignments, eq(agentAssignments.taskId, agentRuns.taskId))
    .where(eq(agentRuns.id, runId));
  if (!run) return refuse("No run");
  if (!run.audience) return;

  const desc = operation.desc;
  if (
    desc.audience === "asker" &&
    canonical(askerOf(input)) === canonical(run.audience.asker)
  ) {
    return;
  }
  const own = new Set([run.taskId, run.requestId].filter((x) => x !== null));
  const subject = subjectOf(desc.subject, input);
  if (
    subject !== null &&
    own.has(subject) &&
    idsIn(input).every((x) => own.has(x))
  ) {
    return;
  }
  if (ALWAYS.has(desc.id)) return;
  if (await spendApproval(deps, runId, desc, input)) return;
  refuse("Needs your approval");
};

/**
 * Marks the run's first unused hub approval of this exact call used, under a
 * lock on the run so two calls can't spend one approval. Returns whether
 * there was one. It is spent even if the operation then fails.
 */
async function spendApproval(
  deps: Parameters<RunGuard>[0],
  runId: string,
  desc: Parameters<typeof hubCallHash>[0],
  input: unknown,
): Promise<boolean> {
  const tool = hubToolName(desc.id);
  const hash = hubCallHash(desc, input);
  return deps.db.transaction(async (tx) => {
    const [run] = await tx
      .select({ hubApprovals: agentRuns.hubApprovals })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .for("update");
    const approvals = run?.hubApprovals ?? [];
    const i = approvals.findIndex(
      (a) => a.usedAt === null && a.tool === tool && a.inputHash === hash,
    );
    if (i < 0) return false;
    const usedAt = deps.now().toISOString();
    await tx
      .update(agentRuns)
      .set({
        hubApprovals: approvals.map((a, k) => (k === i ? { ...a, usedAt } : a)),
      })
      .where(eq(agentRuns.id, runId));
    return true;
  });
}
