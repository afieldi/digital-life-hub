import {
  apply,
  type CoreDeps,
  discard,
  implementOperation,
  RequestUsedError,
  requestOrigin,
  revertUndoToken,
  runMutation,
  undo,
  undoToken,
  writeItems,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { slackActions } from "../db/schema";
import { slackOps } from "../operations";
import {
  type HandleActionInput,
  type HandleActionResult,
  handleActionInput,
} from "../schema";
import { button, doneReply, gatewayFailure } from "./owner/run";

type Reply = HandleActionResult;

/** The bot only acts on its own requests: one the app made is not for a Slack button. */
async function ownRequest(deps: CoreDeps, id: string): Promise<void> {
  if ((await requestOrigin(deps, id)) !== "slack") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "That request wasn't made from Slack.",
    });
  }
}

/** Reverts what a bot action did, once, and says so. */
async function undoAction(deps: CoreDeps, id: string): Promise<Reply> {
  const [row] = await deps.db
    .select()
    .from(slackActions)
    .where(eq(slackActions.id, id));
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "No such action" });
  if (row.usedAt !== null) return { reply: "Already undone." };
  const op = deps.operations.get(row.operation);
  if (op?.kind !== "mutation") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `unknown operation: ${row.operation}`,
    });
  }
  const parsedToken = undoToken.safeParse(row.token);
  if (!parsedToken.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That action's undo record is unreadable.",
    });
  }
  const token = parsedToken.data;
  try {
    await writeItems(deps, async (w) => {
      // Claiming and reverting share a transaction, so a refused revert leaves the row unused.
      const claimed = await w.tx
        .update(slackActions)
        .set({ usedAt: deps.now() })
        .where(and(eq(slackActions.id, id), isNull(slackActions.usedAt)))
        .returning({ id: slackActions.id });
      if (claimed.length === 0) throw new RequestUsedError();
      await revertUndoToken(w, deps, op, token);
    });
  } catch (e) {
    if (e instanceof RequestUsedError) return { reply: "Already undone." };
    if (e instanceof TRPCError && e.code === "CONFLICT") {
      return {
        reply: "Changed since",
        buttons:
          row.runTaskId === null
            ? undefined
            : [
                button("Cancel run", {
                  do: "cancelRun",
                  taskId: row.runTaskId,
                }),
              ],
      };
    }
    throw e;
  }
  return { reply: `Undid ${op.desc.label.toLowerCase()}.` };
}

async function cancelRun(deps: CoreDeps, taskId: string): Promise<Reply> {
  const op = deps.operations.get("agent.cancel");
  if (op?.kind !== "mutation") throw new Error("agent.cancel is missing");
  try {
    await runMutation(deps, op, { id: taskId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "CONFLICT") {
      return { reply: e.message };
    }
    throw e;
  }
  return { reply: "Cancelled." };
}

async function run(deps: CoreDeps, input: HandleActionInput): Promise<Reply> {
  switch (input.do) {
    case "apply": {
      await ownRequest(deps, input.aiRequestId);
      const out = await apply(deps, {
        requestId: input.aiRequestId,
        option: input.option,
      });
      return doneReply(out.requestId, out.summary);
    }
    case "discard":
      await ownRequest(deps, input.aiRequestId);
      await discard(deps, { requestId: input.aiRequestId });
      return { reply: "OK, dropped." };
    case "undo": {
      await ownRequest(deps, input.aiRequestId);
      const out = await undo(deps, { requestId: input.aiRequestId });
      return { reply: `${out.summary}.` };
    }
    case "undoAction":
      return undoAction(deps, input.slackActionId);
    case "cancelRun":
      return cancelRun(deps, input.taskId);
  }
}

/**
 * What a Slack button asks for. Everything runs top-level through `deps`, each
 * step in its own transaction, so nothing goes through the calling operation's
 * writer. A gateway failure, and a request already used, are the reply.
 */
export const handleAction = implementOperation(slackOps.handleAction, {
  async run(_w, input, deps) {
    const parsed = handleActionInput.safeParse(input);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That button isn't one I know.",
      });
    }
    try {
      return { result: await run(deps, parsed.data), undo: null };
    } catch (e) {
      const failure = e instanceof RequestUsedError ? e : gatewayFailure(e);
      if (failure) return { result: { reply: failure.message }, undo: null };
      throw e;
    }
  },
  async undo() {},
  undoRecord: z.null(),
});
