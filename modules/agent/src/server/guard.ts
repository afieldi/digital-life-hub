import { audienceAllows, filesAsSource } from "@dlh/core/audience";
import { hubCallHash, hubToolName } from "@dlh/core/hash";
import type { RunGuard } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { agentAssignments, agentRuns } from "../db/schema";
import { audience as audienceSchema } from "../schema";

const refuse = (message: string): never => {
  throw new TRPCError({ code: "FORBIDDEN", message });
};

/**
 * No run may file a request as you or as a source
 * (`filesAsSource`): that would make it look like your own message, which the
 * agent then runs with full reach. Beyond that, keeps a coworker-audience run
 * to what involves its coworker; without an audience a run is not limited. With one, it may call what
 * `audienceAllows` allows (the rule the runner asks you by, too); anything
 * else needs a hub approval you gave for that exact call, which it spends.
 * Fails closed: a run it can't find, or whose audience it can't read, is
 * refused.
 */
export const runGuard: RunGuard = async (deps, { runId, operation, input }) => {
  // Every run, before its audience is read, and no approval lets it through.
  if (filesAsSource(operation.desc, input)) {
    return refuse("A run can't file as you or as a source");
  }
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
  // Only a real null is no audience; anything else unreadable is refused.
  const parsed = audienceSchema.nullable().safeParse(run.audience);
  if (!parsed.success) return refuse("Needs your approval");
  const audience = parsed.data;
  if (audience === null) return;

  const desc = operation.desc;
  const ofRun = {
    asker: audience.asker,
    taskId: run.taskId,
    requestId: run.requestId,
  };
  if (audienceAllows(desc, input, ofRun)) return;
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
