import { implementOperation } from "@dlh/server";
import { and, asc, desc, eq, gt, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { agentAssignments, agentRunEvents, agentRuns } from "../db/schema";
import { agentOps } from "../operations";
import { eventKind, report } from "../schema";
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

/** What a report of ended runs reads at once. */
const MAX_RECENT_RUNS = 100;

export const recentRuns = implementOperation(agentOps.recentRuns, {
  async run(deps, input) {
    const rows = await deps.db
      .select()
      .from(agentRuns)
      .where(
        and(
          inArray(agentRuns.status, ["done", "failed"]),
          gt(agentRuns.finishedAt, input.since),
        ),
      )
      .orderBy(asc(agentRuns.finishedAt), asc(agentRuns.id))
      .limit(MAX_RECENT_RUNS);
    const taskIds = [...new Set(rows.map((r) => r.taskId))];
    const titles = new Map<string, string>();
    const requests = new Map<string, string | null>();
    if (taskIds.length > 0) {
      const found = await deps.db.execute<{ id: string; title: string }>(
        sql`select id, title from items where id in ${taskIds}`,
      );
      for (const t of found) titles.set(t.id, t.title);
      const assigned = await deps.db
        .select()
        .from(agentAssignments)
        .where(inArray(agentAssignments.taskId, taskIds));
      for (const a of assigned) requests.set(a.taskId, a.requestId);
    }
    return {
      runs: rows.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        taskTitle: titles.get(r.taskId) ?? "",
        requestId: requests.get(r.taskId) ?? null,
        status: r.status === "failed" ? ("failed" as const) : ("done" as const),
        finishedAt: (r.finishedAt ?? r.createdAt).toISOString(),
        report: r.report ? report.parse(r.report) : null,
        failureMessage: r.failureMessage,
      })),
    };
  },
});

export const runSource = implementOperation(agentOps.runSource, {
  async run(deps, input) {
    const [row] = await deps.db
      .select({
        taskId: agentRuns.taskId,
        requestId: agentAssignments.requestId,
      })
      .from(agentRuns)
      .leftJoin(agentAssignments, eq(agentAssignments.taskId, agentRuns.taskId))
      .where(eq(agentRuns.id, input.runId));
    if (!row) notFound("No run");
    return { taskId: row.taskId, requestId: row.requestId ?? null };
  },
});
