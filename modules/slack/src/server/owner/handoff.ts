import { requestOps } from "@dlh/module-requests/operations";
import { type CoreDeps, runMutation } from "@dlh/server";
import { z } from "zod";
import { slackActions } from "../../db/schema";
import type { HandleMessageResult } from "../../schema";
import { type CoworkerMessage, firstLine, keyOf } from "../coworker";
import { button } from "./run";

const filed = z.object({
  request: z.object({ id: z.uuid(), updatedAt: z.string() }),
});

const assigned = z.object({
  task: z.object({ id: z.uuid(), title: z.string() }),
});

/**
 * Files your message as a request from you, gives it to the agent, and offers
 * Undo (until the worker claims the run) and Cancel run. Each step runs
 * top-level through `deps` in its own transaction, so the request is
 * committed before `agent.assignRequest` reads it. `subjectId` is unused
 * until "have the agent review #123" exists.
 */
export async function handOff(
  deps: CoreDeps,
  m: CoworkerMessage,
  _subjectId: string | null,
): Promise<HandleMessageResult> {
  const file = deps.operations.get(requestOps.file.id);
  if (file?.kind !== "mutation") throw new Error("requests.file is missing");
  const assign = deps.operations.get("agent.assignRequest");
  if (assign?.kind !== "mutation") {
    throw new Error("agent.assignRequest is missing");
  }
  const { request } = filed.parse(
    (
      await runMutation(deps, file, {
        title: firstLine(m.event.text),
        body: m.event.text,
        source: "slack",
        externalId: keyOf(m.event),
        sourceUrl: m.event.permalink,
        sourceHandle: m.sender.slackUserId,
        fromName: m.sender.name,
        fromOwner: true,
      })
    ).result,
  );
  const ran = await runMutation(deps, assign, {
    id: request.id,
    expectedUpdatedAt: request.updatedAt,
  });
  const { task } = assigned.parse(ran.result);
  const [action] = await deps.db
    .insert(slackActions)
    .values({
      operation: assign.desc.id,
      token: ran.undo,
      runTaskId: task.id,
    })
    .returning({ id: slackActions.id });
  if (!action) throw new Error("slack action not written");
  return {
    reply: `Given to the agent: ${task.title}`,
    buttons: [
      button("Undo", { do: "undoAction", slackActionId: action.id }),
      button("Cancel run", { do: "cancelRun", taskId: task.id }),
    ],
  };
}
