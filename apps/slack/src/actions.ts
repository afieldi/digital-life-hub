import type { HandleActionInput } from "./api";
import { blocksFor } from "./blocks";
import { type EventDeps, OWNER_FAILED, withRetries } from "./events";

/** A `block_actions` payload, as far as this service reads it. */
export type BlockActionBody = {
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  actions?: { action_id?: string; value?: string }[];
};

/** The button's value as an action input, or null when it isn't one. */
function parseValue(value: string | undefined): HandleActionInput | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { do?: unknown }).do === "string"
    ) {
      return parsed as HandleActionInput;
    }
  } catch {
    // Not JSON: ignored below.
  }
  return null;
}

/**
 * Handles one button click. Only the owner's clicks act: anyone else's is
 * dropped without a word. The hub validates the input itself.
 */
export async function handleBlockAction(
  deps: EventDeps,
  body: BlockActionBody,
): Promise<void> {
  const channel = body.channel?.id;
  if (!channel) return;
  const input = parseValue(body.actions?.[0]?.value);
  if (!input) return;
  const post = (text: string, buttons?: { label: string; value: string }[]) =>
    deps.web.chat.postMessage({
      channel,
      ...blocksFor(text, buttons),
      thread_ts: body.message?.thread_ts ?? body.message?.ts,
    });
  try {
    const settings = await withRetries(deps, () => deps.settings());
    if (!body.user?.id || body.user.id !== settings.ownerSlackId) return;
    const result = await withRetries(deps, () => deps.api.handleAction(input));
    await post(result.reply, result.buttons);
    deps.log?.(`${channel}:${body.message?.ts} action ${input.do} handled`);
  } catch (e) {
    deps.log?.(
      `${channel} action failed: ${e instanceof Error ? e.name : "error"}`,
    );
    try {
      await post(OWNER_FAILED);
    } catch {
      deps.log?.(`${channel} apology not posted`);
    }
  }
}
