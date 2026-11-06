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
  recentIn,
  sendersRequests,
  withdraw,
} from "./coworker";
import { interpretMessage } from "./interpret";
import { handleOwner } from "./owner";
import { readSettings } from "./settings";

/** How long Jev has before the message is handled by rule. */
const JEV_TIMEOUT_MS = 3000;

export const handleMessage = implementOperation(slackOps.handleMessage, {
  async run(w, input, deps) {
    const settings = await readSettings(w.tx);
    const done = (result: HandleMessageResult) => ({ result, undo: null });
    if (settings.ownerSlackId === null)
      return done({ reply: "Not set up yet." });
    if (input.sender.isOwner) {
      return done(await handleOwner(deps, input, settings));
    }
    const m: CoworkerMessage = input;
    const all = await sendersRequests(w, input.sender);
    const open = all.filter((r) => r.resolvedAt === null);
    // The same event again (whatever became of its request): say what was said.
    const key = keyOf(input.event);
    const filed = all.find((r) => r.externalId === key);
    if (filed) {
      return done({ reply: settings.ackText, filedRequestId: filed.id });
    }
    if (all.some((r) => r.appendedIds.includes(key))) {
      return done({ react: "eyes" });
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
    // What Jev thought it might be, best first: the buttons on an escalation.
    let candidates: CoworkerCommand[] = [];
    if (settings.coworkerAi) {
      try {
        const picked = await interpretMessage(deps, {
          text: input.event.text,
          context: input.context,
          commands,
          model: settings.interpreter,
          timeoutMs: JEV_TIMEOUT_MS,
        });
        candidates = [picked.command, ...picked.alternatives].filter((c) =>
          commands.includes(c),
        );
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
            (await escalate(w, m, settings.ackText, candidates)),
        );
      case "escalate":
        return done(await escalate(w, m, settings.ackText, candidates));
    }
  },
  async undo() {},
  undoRecord: z.null(),
});
