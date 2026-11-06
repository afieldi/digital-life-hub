import { AiError, implementOperation } from "@dlh/server";
import { z } from "zod";
import { slackOps } from "../operations";
import type { HandleMessageResult } from "../schema";
import type { CoworkerCommand } from "./commands";
import {
  addToRequest,
  answer,
  type CoworkerMessage,
  escalate,
  keyOf,
  leaveRequest,
  type SenderRequest,
  sendersRequests,
  withdraw,
} from "./coworker";
import { interpretMessage } from "./interpret";
import { readSettings } from "./settings";

/** How long Jev has before the message is handled by rule. */
const JEV_TIMEOUT_MS = 3000;

/** The open request this message follows on from: same DM (or thread), and recent enough. */
function recentIn(
  open: SenderRequest[],
  event: CoworkerMessage["event"],
  now: Date,
  minutes: number,
): SenderRequest | undefined {
  const since = now.getTime() - minutes * 60_000;
  return open.find((r) => {
    const at = r.externalId?.indexOf(":") ?? -1;
    if (!r.externalId || at < 0) return false;
    const channel = r.externalId.slice(0, at);
    const ts = r.externalId.slice(at + 1);
    return (
      channel === event.channel &&
      (event.threadTs === undefined || ts === event.threadTs) &&
      new Date(r.receivedAt).getTime() > since
    );
  });
}

export const handleMessage = implementOperation(slackOps.handleMessage, {
  async run(w, input, deps) {
    const settings = await readSettings(w.tx);
    const done = (result: HandleMessageResult) => ({ result, undo: null });
    if (settings.ownerSlackId === null)
      return done({ reply: "Not set up yet." });
    if (input.sender.isOwner) {
      return done({ reply: "I can't do that from Slack yet." });
    }
    const m: CoworkerMessage = input;
    const open = await sendersRequests(w, input.sender, true);
    // The same event again: it is already filed, so say what was said.
    const filed = open.find((r) => r.externalId === keyOf(input.event));
    if (filed) {
      return done({ reply: settings.ackText, filedRequestId: filed.id });
    }
    const followsOn = recentIn(
      open,
      input.event,
      deps.now(),
      settings.appendMinutes,
    );

    const commands: CoworkerCommand[] = [
      "leaveRequest",
      "requestStatus",
      "askAbout",
    ];
    if (followsOn) commands.push("addToRequest");
    if (open.length > 0) commands.push("withdraw");
    const byRule: CoworkerCommand = followsOn ? "addToRequest" : "leaveRequest";

    let command: CoworkerCommand = byRule;
    if (settings.coworkerAi) {
      try {
        const picked = await interpretMessage(deps, {
          text: input.event.text,
          context: input.context,
          commands,
          model: settings.interpreter,
          timeoutMs: JEV_TIMEOUT_MS,
        });
        command =
          picked.command === "escalate" ||
          picked.confidence < settings.threshold
            ? "escalate"
            : picked.command;
      } catch (e) {
        // A failed Jev is handled by rule; anything else is a bug to surface.
        if (!(e instanceof AiError)) throw e;
      }
    }

    switch (command) {
      case "leaveRequest":
        return done(await leaveRequest(w, m, settings.ackText));
      case "addToRequest":
        return done(
          followsOn
            ? await addToRequest(w, m, followsOn)
            : await leaveRequest(w, m, settings.ackText),
        );
      case "withdraw": {
        const newest = open[0];
        return done(
          newest
            ? await withdraw(w, newest)
            : await leaveRequest(w, m, settings.ackText),
        );
      }
      case "requestStatus":
      case "askAbout":
        return done(
          (await answer(w, deps, m)) ??
            (await escalate(w, m, settings.ackText)),
        );
      case "escalate":
        return done(await escalate(w, m, settings.ackText));
    }
  },
  async undo() {},
  undoRecord: z.null(),
});
