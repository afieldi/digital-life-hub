import { agentOps } from "@dlh/module-agent/operations";
import { requestOps } from "@dlh/module-requests/operations";
import { implementOperation } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { slackOutbox } from "../db/schema";
import { slackOps } from "../operations";
import { replyPlaceOf } from "./coworker";

/** The most an agent run may post. */
const MAX_POSTS = 5;

/** What a post needs of `agent.runSource`. */
const source = z.object({ requestId: z.uuid().nullable() });

/** What a post needs of `requests.get`. */
const filed = z.object({
  request: z.object({
    source: z.string(),
    externalId: z.string().nullable(),
    sourceUrl: z.string().nullable(),
  }),
});

function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

const notFromSlack = (): never => {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "This run didn't come from Slack",
  });
};

const fivePosts = (): never => {
  throw new TRPCError({ code: "CONFLICT", message: "Five posts per run" });
};

/**
 * Queues an agent run's post, as the bot, in the thread of the Slack message
 * its task came from. The run's identity check holds a run to its own
 * `runId`. Born approved; the outbox loop posts it. Keyed
 * `agent:<runId>:<n>`, so at most five per run.
 */
export const postToSource = implementOperation(slackOps.postToSource, {
  async run(w, input, deps) {
    const call = allowed(w.call);
    const { requestId } = source.parse(
      await call(agentOps.runSource, { runId: input.runId }),
    );
    if (requestId === null) return notFromSlack();
    const { request } = filed.parse(
      await call(requestOps.get, { id: requestId }),
    );
    const place = replyPlaceOf(request);
    if (!place) return notFromSlack();

    // Two posts of one run at once number one after the other.
    await w.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`slack.postToSource:${input.runId}`}))`,
    );
    const [row] = await w.tx
      .select({ n: count() })
      .from(slackOutbox)
      .where(
        and(
          eq(slackOutbox.runId, input.runId),
          eq(slackOutbox.origin, "agent"),
        ),
      );
    const n = (row?.n ?? 0) + 1;
    if (n > MAX_POSTS) fivePosts();
    const inserted = await w.tx
      .insert(slackOutbox)
      .values({
        key: `agent:${input.runId}:${n}`,
        origin: "agent",
        status: "approved",
        channelId: place.channelId,
        threadTs: place.threadTs,
        text: input.text,
        requestId,
        runId: input.runId,
        approvedAt: deps.now(),
      })
      .onConflictDoNothing({ target: slackOutbox.key })
      .returning({ id: slackOutbox.id });
    // A key already taken is never reported as posted.
    if (inserted.length === 0) fivePosts();
    return { result: { post: n }, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});
