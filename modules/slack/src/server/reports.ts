import { agentOps } from "@dlh/module-agent/operations";
import { requestOps } from "@dlh/module-requests/operations";
import { implementOperation } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { slackOutbox, slackSettings } from "../db/schema";
import { slackOps } from "../operations";
import { threadOf } from "./coworker";

/** What `agent.recentRuns` returns, as far as a report needs it. */
const recent = z.object({
  runs: z.array(
    z.object({
      id: z.uuid(),
      taskTitle: z.string(),
      requestId: z.uuid().nullable(),
      status: z.enum(["done", "failed"]),
      finishedAt: z.iso.datetime(),
      report: z
        .object({
          summary: z.string(),
          links: z.array(z.object({ label: z.string(), url: z.string() })),
        })
        .nullable(),
      failureMessage: z.string().nullable(),
    }),
  ),
});

/** What a report needs of `requests.get`. */
const filed = z.object({
  request: z.object({
    source: z.string(),
    fromOwner: z.boolean(),
    externalId: z.string().nullable(),
    sourceUrl: z.string().nullable(),
  }),
});

type Run = z.infer<typeof recent>["runs"][number];

/** The text posted for a run that ended; empty parts are left out. */
function reportText(run: Run): string {
  if (run.status === "failed") {
    const why = run.failureMessage?.trim();
    return `The agent couldn't finish ${run.taskTitle}${why ? `: ${why}` : "."}`;
  }
  const links = (run.report?.links ?? []).map((l) => `${l.label}: ${l.url}`);
  return [`Done: ${run.taskTitle}`, run.report?.summary.trim(), ...links]
    .filter((part) => part)
    .join("\n");
}

function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

export const syncRuns = implementOperation(slackOps.syncRuns, {
  async run(w, _input, deps) {
    const [row] = await w.tx
      .select({ syncedAt: slackSettings.runsSyncedAt })
      .from(slackSettings)
      .where(eq(slackSettings.id, 1))
      .for("update");
    if (!row) throw new Error("slack_settings has no row");
    const set = (at: Date) =>
      w.tx
        .update(slackSettings)
        .set({ runsSyncedAt: at })
        .where(eq(slackSettings.id, 1));
    if (row.syncedAt === null) {
      // Runs that ended before the bot was listening are not news.
      await set(deps.now());
      return { result: { reported: 0 }, undo: null };
    }
    const { runs } = recent.parse(
      await allowed(w.call)(agentOps.recentRuns, {
        since: row.syncedAt,
      }),
    );
    let reported = 0;
    for (const run of runs) {
      if (run.requestId === null) continue;
      let request: z.infer<typeof filed>["request"];
      try {
        request = filed.parse(
          await allowed(w.call)(requestOps.get, { id: run.requestId }),
        ).request;
      } catch (e) {
        // A request deleted since has nobody to tell.
        if (e instanceof TRPCError && e.code === "NOT_FOUND") continue;
        throw e;
      }
      const at = request.externalId?.indexOf(":") ?? -1;
      if (
        request.source !== "slack" ||
        !request.fromOwner ||
        !request.externalId ||
        at < 0
      ) {
        continue;
      }
      const ts = request.externalId.slice(at + 1);
      const inserted = await w.tx
        .insert(slackOutbox)
        .values({
          key: `report:${run.id}`,
          origin: "report",
          status: "approved",
          channelId: request.externalId.slice(0, at),
          // Into the thread it was asked in, or under the message itself.
          threadTs: threadOf({ sourceUrl: request.sourceUrl }) ?? ts,
          text: reportText(run),
          requestId: run.requestId,
          runId: run.id,
          approvedAt: deps.now(),
        })
        .onConflictDoNothing({ target: slackOutbox.key })
        .returning({ id: slackOutbox.id });
      reported += inserted.length;
    }
    const last = runs.at(-1);
    if (last) await set(new Date(last.finishedAt));
    return { result: { reported }, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});
