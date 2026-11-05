import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Report, SuspendRequest } from "@dlh/agent-protocol";
import { z } from "zod";
import type { EventSink } from "./events";
import type { Host } from "./host";

/**
 * How a session ended: reported to the worker (`finished`, `failed`,
 * `suspended`, `no_report`), or not, because the worker refused or was gone.
 */
export type Outcome =
  | "finished"
  | "failed"
  | "suspended"
  | "no_report"
  | "host_error";

/**
 * What the runner asked, kept on the volume across the suspend (D8). `seq` is
 * the worker's number for the ask; null only if the runner stopped between
 * writing this and hearing back.
 */
export const pending = z.object({
  seq: z.number().int().nullable(),
  kind: z.enum(["approval", "grant"]),
  tool: z.string().optional(),
  inputHash: z.string().optional(),
  connectionName: z.string().optional(),
  action: z.string(),
});
export type Pending = z.infer<typeof pending>;

export const pendingPath = (workspace: string) =>
  join(workspace, ".dlh", "pending.json");

/** The pending ask on the volume, or null when there is none (or it's unreadable). */
export function readPending(workspace: string): Pending | null {
  try {
    return pending.parse(
      JSON.parse(readFileSync(pendingPath(workspace), "utf8")),
    );
  } catch {
    return null;
  }
}

export function clearPending(workspace: string) {
  rmSync(pendingPath(workspace), { force: true });
}

function writePending(workspace: string, p: Pending) {
  const file = pendingPath(workspace);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(p)}\n`);
}

export type Suspension = Omit<SuspendRequest, "sessionId"> & {
  connectionName?: string;
  /** The exact action quoted to the owner, at most 500 characters. */
  action: string;
};

/** The three ways a run ends from inside the session. Each ends the session. */
export interface RunControl {
  /** True once a finish, fail or suspend is under way. */
  ending(): boolean;
  /** Resolves once the report under way, if any, has been answered. */
  settled(): Promise<void>;
  finish(report: Report): Promise<void>;
  fail(code: string, message: string): Promise<void>;
  suspend(s: Suspension): Promise<void>;
}

/**
 * Ends the run through the worker: the held events go first (the worker takes
 * none after a report), then the report. The worker stops the container once
 * it answers, so whatever happens after is best effort. A refused report ends
 * the session too, as `host_error`: the worker has given up on the run.
 */
export function createControl(deps: {
  host: Host;
  workspace: string;
  sessionId: () => string | undefined;
  events: EventSink;
  /** Awaited before the report's caller hears back, e.g. to stop the turn. */
  onEnd: (outcome: Outcome) => void | Promise<void>;
}): RunControl {
  let ending = false;
  let reporting: Promise<unknown> = Promise.resolve();

  async function report(outcome: Outcome, send: () => Promise<unknown>) {
    try {
      await deps.events.drain();
      await send();
    } catch (e) {
      await deps.onEnd("host_error");
      throw e;
    }
    await deps.onEnd(outcome);
  }

  function end(outcome: Outcome, send: () => Promise<unknown>): Promise<void> {
    if (ending) return Promise.reject(new Error("The run is already ending"));
    ending = true;
    const p = report(outcome, send);
    reporting = p.catch(() => {});
    return p;
  }

  return {
    ending: () => ending,
    settled: async () => {
      await reporting;
    },
    finish: (report) => end("finished", () => deps.host.finish({ report })),
    fail: (code, message) =>
      end(code === "no_report" ? "no_report" : "failed", () =>
        deps.host.fail({ code, message }),
      ),
    suspend: ({ connectionName, action, ...req }) =>
      end("suspended", async () => {
        const sessionId = deps.sessionId();
        if (!sessionId) throw new Error("No session to resume yet");
        const kept = {
          kind: req.kind,
          ...(req.tool ? { tool: req.tool } : {}),
          ...(req.inputHash ? { inputHash: req.inputHash } : {}),
          ...(connectionName ? { connectionName } : {}),
          action,
        };
        // Written before asking, so a stop in between still finds it.
        writePending(deps.workspace, { seq: null, ...kept });
        const { seq } = await deps.host.suspend({ sessionId, ...req });
        writePending(deps.workspace, { seq, ...kept });
      }),
  };
}
