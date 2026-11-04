import { expect, test } from "vitest";
import { type RunStatus, runStatus } from "../src/schema";
import { canMove, isDueBy } from "../src/server/claimRules";

/** The lifecycle's moves; every other pair is refused. */
const LEGAL: ReadonlySet<string> = new Set([
  "queued→running",
  "queued→cancelled",
  "running→done",
  "running→failed",
  "running→waiting",
  "running→queued",
  "running→cancelled",
  "waiting→queued",
  "waiting→cancelled",
  "failed→queued",
  "cancelled→queued",
]);

test("every illegal transition is refused", () => {
  const all: RunStatus[] = runStatus.options;
  const table = all.flatMap((from) =>
    all.map((to) => ({ move: `${from}→${to}`, ok: canMove(from, to) })),
  );
  expect(table).toHaveLength(36);
  expect(table).toEqual(
    table.map(({ move }) => ({ move, ok: LEGAL.has(move) })),
  );
});

const NOW = new Date("2026-11-04T12:00:00Z");

test("no due is due", () => {
  expect(isDueBy(null, NOW, "UTC")).toBe(true);
});

test("a timed due in the future waits", () => {
  expect(
    isDueBy({ dateTime: "2026-11-04T12:00:01Z" }, NOW, "Europe/Warsaw"),
  ).toBe(false);
  expect(isDueBy({ dateTime: "2026-11-04T13:00:00+01:00" }, NOW, "UTC")).toBe(
    true,
  );
  expect(isDueBy({ dateTime: "2026-11-04T11:59:59Z" }, NOW, "UTC")).toBe(true);
});

test("an all-day due is due from midnight in the settings time zone", () => {
  const due = { date: "2026-11-05" };
  // 23:00 UTC on the 4th is already the 5th in Warsaw (UTC+1), not in New York.
  const late = new Date("2026-11-04T23:00:00Z");
  expect(isDueBy(due, late, "Europe/Warsaw")).toBe(true);
  expect(isDueBy(due, late, "America/New_York")).toBe(false);
  expect(isDueBy(due, late, "UTC")).toBe(false);
  // Just before midnight in Warsaw it still waits.
  expect(isDueBy(due, new Date("2026-11-04T22:59:59Z"), "Europe/Warsaw")).toBe(
    false,
  );
  expect(isDueBy({ date: "2026-11-04" }, NOW, "UTC")).toBe(true);
});
