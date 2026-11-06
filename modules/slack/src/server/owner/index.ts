import { requestOps } from "@dlh/module-requests/operations";
import { AiError, type CoreDeps, runMutation } from "@dlh/server";
import type {
  HandleMessageInput,
  HandleMessageResult,
  SlackSettings,
} from "../../schema";
import { ESCALATED_PREFIX, firstLine } from "../coworker";
import { interpretOwner, type OwnerPick } from "./interpret";
import { runOwnerAction } from "./run";

/** How long Jev has before the owner's message is escalated. */
const JEV_TIMEOUT_MS = 3000;
/** How many earlier messages Jev sees. */
const CONTEXT_TURNS = 10;

/** Files the message for you, with no actions, so the request keeps its usual outcomes. */
async function escalateOwner(
  deps: CoreDeps,
  input: HandleMessageInput,
): Promise<HandleMessageResult> {
  const file = deps.operations.get(requestOps.file.id);
  if (file?.kind !== "mutation") throw new Error("requests.file is missing");
  await runMutation(deps, file, {
    title: `${ESCALATED_PREFIX}${firstLine(input.event.text)}`,
    body: input.event.text,
    source: "slack",
    externalId: `${input.event.channel}:${input.event.ts}`,
    sourceUrl: input.event.permalink,
    sourceHandle: input.sender.slackUserId,
    fromName: input.sender.name,
  });
  return { reply: "Not sure what you meant, so I put it in your queue." };
}

/**
 * Handles a message from you: Jev picks what it means, and the gateway runs
 * it as you. Everything runs top-level through `deps`, each write in its own
 * transaction, so nothing goes through the calling operation's writer.
 */
export async function handleOwner(
  deps: CoreDeps,
  input: HandleMessageInput,
  settings: SlackSettings,
): Promise<HandleMessageResult> {
  let pick: OwnerPick;
  try {
    pick = await interpretOwner(deps, {
      text: input.event.text,
      context: input.context.slice(-CONTEXT_TURNS),
      model: settings.interpreter,
      timeoutMs: JEV_TIMEOUT_MS,
      threshold: settings.threshold,
    });
  } catch (e) {
    // Jev being down is said in its own words; anything else is a bug.
    if (e instanceof AiError) return { reply: e.message };
    throw e;
  }
  switch (pick.kind) {
    case "action":
      return runOwnerAction(deps, {
        text: input.event.text,
        actionId: pick.actionId,
        aiKind: pick.aiKind,
        subjectId: pick.subjectId,
      });
    case "escalate":
      return escalateOwner(deps, input);
    case "handOff":
    case "draftReply":
      throw new Error("NOT_IMPLEMENTED");
  }
}
