import type { AiKind } from "@dlh/core";
import { AiError, type CoreDeps, cancel, prepare } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import type {
  HandleActionInput,
  HandleActionResult,
  HandleMessageResult,
} from "../../schema";

export const button = (label: string, input: HandleActionInput) => ({
  label,
  value: JSON.stringify(input),
});

/** What an applied request says: what was done, and the way to undo it. */
export const doneReply = (
  requestId: string,
  summary: string,
): HandleActionResult => ({
  reply: `Done: ${summary}`,
  buttons: [button("Undo", { do: "undo", aiRequestId: requestId })],
});

/** The gateway throws its `AiError` as the cause of a tRPC error. */
export function gatewayFailure(e: unknown): AiError | null {
  const failure = e instanceof TRPCError ? e.cause : e;
  return failure instanceof AiError ? failure : null;
}

/**
 * Runs `actionId` as `aiKind` through the gateway, as you would from the app
 * but with `origin: "slack"`, and says what happened in words and buttons.
 * A gateway failure is the reply: its message already says what to do.
 */
export async function runOwnerAction(
  deps: CoreDeps,
  input: {
    text: string;
    actionId: string;
    aiKind: AiKind;
    subjectId: string | null;
  },
): Promise<HandleMessageResult> {
  try {
    const out = await prepare(
      deps,
      {
        text: input.text,
        actionId: input.actionId,
        kind: input.aiKind,
        itemId: input.subjectId ?? undefined,
      },
      { origin: "slack" },
    );
    switch (out.status) {
      case "answered":
        return { reply: out.answer };
      case "listed":
        return {
          reply: [out.heading, ...out.items.map((i) => `• ${i.title}`)].join(
            "\n",
          ),
        };
      case "suggested":
        return {
          reply: "Pick one:",
          buttons: [
            ...out.options.map((o, option) =>
              button(o.label, {
                do: "apply",
                aiRequestId: out.requestId,
                option,
              }),
            ),
            button("None of these", {
              do: "discard",
              aiRequestId: out.requestId,
            }),
          ],
        };
      case "applied":
        return doneReply(out.requestId, out.summary);
      case "run":
        // The server provider is what answers from Slack; a CLI run needs the
        // app. Nothing will run it, so the pending request is cancelled.
        await cancel(deps, { requestId: out.requestId });
        return { reply: "That needs the app to run." };
    }
  } catch (e) {
    const failure = gatewayFailure(e);
    if (failure) return { reply: failure.message };
    throw e;
  }
}
