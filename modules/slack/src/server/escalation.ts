import { requestOps } from "@dlh/module-requests/operations";
import {
  type CoreDeps,
  implementOperation,
  type ScopedWriter,
  type Tx,
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
  leaveRequest,
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

async function loadRequest(w: ScopedWriter, id: string) {
  return filed.parse(await allowed(w.call)(requestOps.get, { id })).request;
}

async function resolveAs(
  w: ScopedWriter,
  id: string,
  outcome: "handled" | "not_for_me",
): Promise<void> {
  // Read after the command ran: it may have touched this request's version.
  const { updatedAt } = await loadRequest(w, id);
  await allowed(w.call)(requestOps.resolve, {
    id,
    expectedUpdatedAt: updatedAt,
    outcome,
  });
}

/** The message as the sender sent it, rebuilt from the request they became. */
async function messageOf(
  tx: Tx,
  r: z.infer<typeof filed>["request"],
): Promise<{
  m: CoworkerMessage;
  thread: string;
}> {
  const at = r.externalId?.indexOf(":") ?? -1;
  if (r.source !== "slack" || !r.externalId || at < 0 || !r.sourceHandle) {
    badRequest("Not a request filed from Slack");
  }
  const channel = r.externalId.slice(0, at);
  const ts = r.externalId.slice(at + 1);
  const threadTs = threadOf({ sourceUrl: r.sourceUrl }) ?? undefined;
  const [person] = await tx
    .select({ githubLogin: slackPeople.githubLogin })
    .from(slackPeople)
    .where(eq(slackPeople.slackUserId, r.sourceHandle));
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
        githubLogin: person?.githubLogin ?? null,
        isOwner: false,
      },
      context: [],
    },
    // A reply in the thread of the message, or the message's own thread.
    thread: threadTs ?? ts,
  };
}

/** The reply `command` makes, run for the sender as `handleMessage` would. */
async function runCommand(
  w: ScopedWriter,
  deps: CoreDeps,
  m: CoworkerMessage,
  command: z.infer<typeof slackOps.runEscalated.input>["command"],
  escalated: string,
): Promise<HandleMessageResult> {
  const settings = await readSettings(w.tx);
  // The escalation itself is not one of their requests: handleMessage ran before it was filed.
  const others: SenderRequest[] = (await sendersRequests(w, m.sender)).filter(
    (r) => r.id !== escalated,
  );
  const open = others.filter((r) => r.resolvedAt === null);
  switch (command) {
    case "leaveRequest":
      // Already filed, as this request; the sender hears the usual acknowledgement.
      return leaveRequest(w, m, settings.ackText);
    case "addToRequest": {
      const target = recentIn(
        open,
        m.event,
        deps.now(),
        settings.appendMinutes,
      );
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
      const out = await answer(w, deps, m, escalated);
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
    const request = await loadRequest(w, input.requestId);
    if (request.outcome !== null) {
      if (request.outcome !== "handled") conflict("Already resolved");
      // Pressed twice, or on two devices: what it queued is already queued.
      const [row] = await w.tx
        .select({ text: slackOutbox.text })
        .from(slackOutbox)
        .where(eq(slackOutbox.key, `escalation:${input.requestId}`));
      return { result: { reply: row?.text ?? null }, undo: null };
    }
    const { m, thread } = await messageOf(w.tx, request);
    const out = await runCommand(w, deps, m, input.command, input.requestId);
    await resolveAs(w, input.requestId, "handled");
    if (out.reply === undefined) {
      return { result: { reply: null }, undo: null };
    }
    const [queued] = await w.tx
      .insert(slackOutbox)
      .values({
        key: `escalation:${input.requestId}`,
        origin: "escalation",
        as: "bot",
        status: "approved",
        channelId: m.event.channel,
        threadTs: thread,
        text: out.reply,
        requestId: input.requestId,
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
      await resolveAs(w, input.requestId, "not_for_me");
      return { result: { requestId: input.requestId }, undo: null };
    },
    async undo() {},
    undoRecord: z.null(),
  },
);
