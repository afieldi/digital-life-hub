import { requestOps } from "@dlh/module-requests/operations";
import {
  type CoreDeps,
  implementOperation,
  type ScopedWriter,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { slackOutbox, slackPeople } from "../db/schema";
import { slackOps } from "../operations";
import type { HandleMessageResult } from "../schema";
import {
  addToRequest,
  answer,
  type CoworkerMessage,
  ESCALATED_PREFIX,
  keyOf,
  recentIn,
  type SenderRequest,
  sendersRequests,
  threadOf,
  withdraw,
} from "./coworker";
import { readSettings } from "./settings";

function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

const filed = z.object({
  request: z.object({
    id: z.uuid(),
    updatedAt: z.string(),
    body: z.string().nullable(),
    fromName: z.string().nullable(),
    source: z.string(),
    sourceHandle: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    externalId: z.string().nullable(),
    outcome: z.enum(["task", "handled", "not_for_me"]).nullable(),
  }),
});

/** The escalation a button names: the sender's request filed from that message. */
async function findEscalation(
  w: ScopedWriter,
  message: { slackUserId: string; externalId: string },
) {
  const [person] = await w.tx
    .select({ githubLogin: slackPeople.githubLogin })
    .from(slackPeople)
    .where(eq(slackPeople.slackUserId, message.slackUserId));
  const rows = await sendersRequests(w, {
    slackUserId: message.slackUserId,
    githubLogin: person?.githubLogin ?? null,
  });
  const found = rows.find((r) => r.externalId === message.externalId);
  if (!found) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
  }
  const { request } = filed.parse(
    await allowed(w.call)(requestOps.get, { id: found.id }),
  );
  return { request, found, rows, githubLogin: person?.githubLogin ?? null };
}

async function resolveAs(
  w: ScopedWriter,
  id: string,
  outcome: "handled" | "not_for_me",
): Promise<void> {
  // Read after the command ran: it may have touched this request's version.
  const { request } = filed.parse(
    await allowed(w.call)(requestOps.get, { id }),
  );
  await allowed(w.call)(requestOps.resolve, {
    id,
    expectedUpdatedAt: request.updatedAt,
    outcome,
  });
}

/** The message as the sender sent it, rebuilt from the request they became. */
function messageOf(
  r: z.infer<typeof filed>["request"],
  githubLogin: string | null,
): { m: CoworkerMessage; thread: string } {
  const at = r.externalId?.indexOf(":") ?? -1;
  if (r.source !== "slack" || !r.externalId || at < 0 || !r.sourceHandle) {
    badRequest("Not a request filed from Slack");
  }
  const channel = r.externalId.slice(0, at);
  const ts = r.externalId.slice(at + 1);
  const threadTs = threadOf({ sourceUrl: r.sourceUrl }) ?? undefined;
  return {
    m: {
      event: {
        channel,
        ts,
        threadTs,
        // A click has no live conversation: the request's own text stands in.
        text: r.body ?? "",
        permalink: r.sourceUrl ?? "",
        isDm: channel.startsWith("D"),
      },
      sender: {
        slackUserId: r.sourceHandle,
        name: r.fromName ?? "",
        githubLogin,
        isOwner: false,
      },
      context: [],
    },
    // A reply in the thread of the message, or the message's own thread.
    thread: threadTs ?? ts,
  };
}

/**
 * Files the escalated message again as a plain request (no "Bot wasn't sure",
 * no buttons), and queues no reply: the sender was acknowledged when it escalated.
 */
async function keepRequest(
  w: ScopedWriter,
  m: CoworkerMessage,
  escalated: SenderRequest,
): Promise<HandleMessageResult> {
  await allowed(w.call)(requestOps.file, {
    title: escalated.title.replace(ESCALATED_PREFIX, ""),
    body: m.event.text,
    source: "slack",
    externalId: `${keyOf(m.event)}:kept`,
    sourceUrl: m.event.permalink,
    sourceHandle: m.sender.slackUserId,
    fromName: m.sender.name,
  });
  return {};
}

/** The reply `command` makes, run for the sender as `handleMessage` would. */
async function runCommand(
  w: ScopedWriter,
  deps: CoreDeps,
  m: CoworkerMessage,
  command: z.infer<typeof slackOps.runEscalated.input>["command"],
  escalated: SenderRequest,
  rows: SenderRequest[],
): Promise<HandleMessageResult> {
  const settings = await readSettings(w.tx);
  const at = new Date(escalated.receivedAt);
  // As of the message, as handleMessage saw it: the escalation itself did not
  // exist yet, nor did anything filed after it.
  const open = rows.filter(
    (r) =>
      r.id !== escalated.id &&
      r.resolvedAt === null &&
      new Date(r.receivedAt).getTime() <= at.getTime(),
  );
  switch (command) {
    case "leaveRequest":
      // The escalation already acknowledged the sender; this files the plain request.
      return keepRequest(w, m, escalated);
    case "addToRequest": {
      // Recent as of the message, not of the click.
      const target = recentIn(open, m.event, at, settings.appendMinutes);
      if (!target) conflict("They have no recent open request to add to");
      return addToRequest(w, m, target);
    }
    case "withdraw": {
      const newest = open[0];
      if (!newest) conflict("They have no other open request to withdraw");
      return withdraw(w, newest);
    }
    case "requestStatus":
    case "askAbout": {
      const out = await answer(w, deps, m, escalated.id);
      if (!out) conflict("The bot couldn't answer that");
      return out;
    }
  }
}

/** What undo needs: the queued reply, if one was. */
const undoRecord = z.object({ outboxId: z.uuid() }).nullable();

export const runEscalated = implementOperation(slackOps.runEscalated, {
  async run(
    w,
    input,
    deps,
  ): Promise<{
    result: { reply: string | null };
    undo: z.infer<typeof undoRecord>;
  }> {
    const { request, found, rows, githubLogin } = await findEscalation(
      w,
      input,
    );
    const requestId = request.id;
    if (request.outcome !== null) {
      if (request.outcome !== "handled") conflict("Already resolved");
      // Pressed twice, or on two devices: what it queued is already queued.
      const [row] = await w.tx
        .select({ text: slackOutbox.text })
        .from(slackOutbox)
        .where(eq(slackOutbox.key, `escalation:${requestId}`));
      return { result: { reply: row?.text ?? null }, undo: null };
    }
    const { m, thread } = messageOf(request, githubLogin);
    const out = await runCommand(w, deps, m, input.command, found, rows);
    await resolveAs(w, requestId, "handled");
    if (out.reply === undefined) {
      return { result: { reply: null }, undo: null };
    }
    const [queued] = await w.tx
      .insert(slackOutbox)
      .values({
        key: `escalation:${requestId}`,
        origin: "escalation",
        as: "bot",
        status: "approved",
        channelId: m.event.channel,
        threadTs: thread,
        text: out.reply,
        requestId: requestId,
        approvedAt: deps.now(),
      })
      .onConflictDoNothing({ target: slackOutbox.key })
      .returning({ id: slackOutbox.id });
    return {
      result: { reply: out.reply },
      undo: queued ? { outboxId: queued.id } : null,
    };
  },
  async undo(w, record) {
    if (!record) return;
    const removed = await w.tx
      .delete(slackOutbox)
      .where(
        and(
          eq(slackOutbox.id, record.outboxId),
          eq(slackOutbox.status, "approved"),
        ),
      )
      .returning({ id: slackOutbox.id });
    if (removed.length === 0) conflict("Already sent");
  },
  undoRecord,
});

export const dismissEscalation = implementOperation(
  slackOps.dismissEscalation,
  {
    async run(w, input) {
      const { request } = await findEscalation(w, input);
      await resolveAs(w, request.id, "not_for_me");
      return { result: { requestId: request.id }, undo: null };
    },
    async undo() {},
    undoRecord: z.null(),
  },
);
