import type { AiKind } from "@dlh/core";
import { AiError, type CoreDeps, prepare } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import type { HandleActionInput, HandleMessageResult } from "../../schema";

const button = (label: string, input: HandleActionInput) => ({
  label,
  value: JSON.stringify(input),
});

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
        return {
          reply: `Done: ${out.summary}`,
          buttons: [button("Undo", { do: "undo", aiRequestId: out.requestId })],
        };
      case "run":
        // The server provider is what answers from Slack; a CLI run needs the app.
        return { reply: "That needs the app to run." };
    }
  } catch (e) {
    // The gateway throws its AiError as the cause of a tRPC error.
    const failure = e instanceof TRPCError ? e.cause : e;
    if (failure instanceof AiError) return { reply: failure.message };
    throw e;
  }
}
