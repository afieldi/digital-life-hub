import { parseDue } from "@dlh/core/capture";
import { scriptedFakeProvider } from "@dlh/server";
import { expect, test } from "vitest";
import { z } from "zod";
import { taskOps } from "../src/operations";

// The e2e "what's due friday?" test asks the dev fake, which fills `due`'s
// range from the prompt's today; the day "friday" names must fall inside it,
// on a Friday too (when it means a week on).
test.each([
  ["Fri, Nov 6, 2026", "2026-11-06T10:00:00Z"],
  ["Mon, Nov 2, 2026", "2026-11-02T10:00:00Z"],
  ["Sat, Nov 7, 2026", "2026-11-07T10:00:00Z"],
])(
  "the fake's due range on %s holds the Friday parseDue picks",
  async (today, now) => {
    const timeZone = "Europe/Warsaw";
    const { raw } = await scriptedFakeProvider.complete({
      system: "",
      prompt: `Today is ${today} (${timeZone}).\n<instruction>\nwhat's due friday\n</instruction>`,
      schema: z.toJSONSchema(taskOps.due.input) as object,
      model: "m",
      signal: new AbortController().signal,
    });
    const { from, to } = JSON.parse(raw) as { from: string; to: string };
    const friday = parseDue("friday", { now: new Date(now), timeZone });
    if (!friday || !("date" in friday)) throw new Error("no friday");
    expect(friday.date >= from && friday.date < to).toBe(true);
  },
);
