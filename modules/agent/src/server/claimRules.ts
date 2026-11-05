import { type Due, dayOfDue, todayIn } from "@dlh/core";
import type { RunStatus } from "../schema";

/**
 * The run lifecycle's moves: claimed, ended, suspended, back to the queue (a
 * missed heartbeat, your answer, a Retry) and cancelled while live.
 */
const MOVES: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["done", "failed", "waiting", "queued", "cancelled"],
  waiting: ["queued", "cancelled"],
  done: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

/** Whether a run may go from `from` to `to`. */
export function canMove(from: RunStatus, to: RunStatus): boolean {
  return MOVES[from].includes(to);
}

/**
 * Whether a task due at `due` may start at `now`: no due always may, a timed
 * due from its moment, an all-day due from midnight in `timeZone`.
 */
export function isDueBy(due: Due | null, now: Date, timeZone: string): boolean {
  if (!due) return true;
  if ("dateTime" in due) return new Date(due.dateTime) <= now;
  const day = dayOfDue(due, timeZone);
  return day === null || day <= todayIn(now, timeZone);
}
