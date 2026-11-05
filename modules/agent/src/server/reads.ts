import { implementOperation } from "@dlh/server";
import { and, asc, desc, eq, gt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { agentRunEvents, agentRuns } from "../db/schema";
import { agentOps } from "../operations";
import { eventKind } from "../schema";
import { notFound, toRunRow } from "./runs";

const MAX_EVENTS = 500;
const eventData = z.record(z.string(), z.unknown());
/** A task has a handful of runs; a status list is the panel's, not an export. */
const MAX_RUNS = 200;

export const run = implementOperation(agentOps.run, {
  async run(deps, input) {
    const [row] = await deps.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId));
    if (!row) notFound("No run");
    return toRunRow(row);
  },
});

export const runs = implementOperation(agentOps.runs, {
  async run(deps, input) {
    const where: SQL[] = [];
    if (input.taskId) where.push(eq(agentRuns.taskId, input.taskId));
    if (input.status) where.push(eq(agentRuns.status, input.status));
    const rows = await deps.db
      .select()
      .from(agentRuns)
      .where(and(...where))
      .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
      .limit(MAX_RUNS);
    return { runs: rows.map(toRunRow) };
  },
});

export const events = implementOperation(agentOps.events, {
  async run(deps, input) {
    const rows = await deps.db
      .select()
      .from(agentRunEvents)
      .where(
        and(
          eq(agentRunEvents.runId, input.runId),
          input.after === undefined
            ? undefined
            : gt(agentRunEvents.seq, input.after),
        ),
      )
      .orderBy(asc(agentRunEvents.seq))
      .limit(MAX_EVENTS);
    return {
      events: rows.map((e) => ({
        seq: e.seq,
        at: e.at.toISOString(),
        kind: eventKind.parse(e.kind),
        data: eventData.parse(e.data),
      })),
    };
  },
});
