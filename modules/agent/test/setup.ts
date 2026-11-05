import type { CoreDeps } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import requestsServer from "../../requests/src/server";
import tasksServer from "../../tasks/src/server";
import { agentRuns } from "../src/db/schema";
import agentServer from "../src/server";

/** A database with Tasks, Requests and Agent, and a caller signed in as you. */
export async function setup() {
  const t = await freshModuleDb([tasksServer, requestsServer, agentServer]);
  const { deps, caller } = testServer(t.db, [
    tasksServer,
    requestsServer,
    agentServer,
  ]);
  const mkTask = async (title = "Fix the build") =>
    (await caller.tasks.create({ title })).result;
  const file = async (title: string, extra: Record<string, unknown> = {}) =>
    (await caller.requests.file({ title, ...extra })).result.request;
  return { ...t, deps, caller, mkTask, file };
}

/** The item's current version, as the API sends it. */
export async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

export async function assigneeOf(deps: CoreDeps, taskId: string) {
  const rows = await deps.db.execute<{ assignee: string }>(
    sql`select assignee from tasks where item_id = ${taskId}`,
  );
  return rows[0]?.assignee;
}

export async function isDeleted(deps: CoreDeps, id: string) {
  const rows = await deps.db.execute<{ deleted: boolean }>(
    sql`select deleted_at is not null as deleted from items where id = ${id}`,
  );
  return rows[0]?.deleted;
}

export async function runsOf(deps: CoreDeps, taskId: string) {
  return deps.db.select().from(agentRuns).where(eq(agentRuns.taskId, taskId));
}
