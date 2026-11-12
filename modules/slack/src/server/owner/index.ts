import { AiError, type CoreDeps } from "@dlh/server";
import type {
  HandleMessageInput,
  HandleMessageResult,
  SlackSettings,
} from "../../schema";
import { handOff } from "./handoff";
import { interpretOwner, type OwnerPick } from "./interpret";
import { replyToOwner } from "./reply";
import { runOwnerAction } from "./run";

/** How long Jev has to pick before the owner is told it timed out. */
const JEV_TIMEOUT_MS = 3000;
/** How many earlier messages Jev sees. */
const CONTEXT_TURNS = 10;

/**
 * Said when Jev can't tell what your message means. You are already in the
 * DM, so the bot asks you there instead of filing your own message to you.
 */
export const UNSURE_REPLY =
  'Not sure what you meant. Could you say it another way? If it\'s work for the agent, say "give it to the agent".';

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
      ownerName: input.sender.name,
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
    case "reply":
      return replyToOwner(deps, input);
    case "escalate":
      return { reply: UNSURE_REPLY };
    case "handOff":
      return handOff(deps, input, pick.subjectId);
  }
}
