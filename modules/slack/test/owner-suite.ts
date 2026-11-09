import type { CoreDeps } from "@dlh/server";
import { interpretOwner } from "../src/server/owner/interpret";
import type { OwnerPhrasing, OwnerSubject } from "./owner-phrasings";
import type { setup } from "./setup";

type Harness = Awaited<ReturnType<typeof setup>>;

/** Tasks, and a Slack request from Dana, for the subject questions to choose between. */
export async function seedOwnerItems(
  caller: Harness["caller"],
): Promise<Record<OwnerSubject, string>> {
  const task = async (title: string) =>
    (await caller.tasks.create({ title })).result.id;
  const request = (
    await caller.requests.file({
      title: "Dana asks for the roadmap deck",
      body: "Could you send me the Q3 roadmap deck?",
      source: "slack",
      externalId: "D1:1.1",
      sourceUrl: "https://example.slack.com/archives/D1/p1",
      sourceHandle: "U1",
      fromName: "Dana",
    })
  ).result.request.id;
  return {
    invoice: await task("Chase Dana about the invoice"),
    roadmap: await task("Write the Q3 roadmap"),
    dentist: await task("Book the dentist appointment"),
    offsite: await task("Plan the team offsite"),
    dana: request,
  };
}

/**
 * Runs each phrasing through `interpretOwner` with the real gateway actions
 * (Core's, Tasks' and Requests') and seeded items.
 */
export async function runOwnerSuite(
  s: Harness,
  phrasings: OwnerPhrasing[],
  model: string,
  threshold = 0.6,
) {
  const ids = await seedOwnerItems(s.caller);
  const misses: { phrasing: OwnerPhrasing; got: string }[] = [];
  for (const phrasing of phrasings) {
    const pick = await interpretOwner(s.deps as CoreDeps, {
      text: phrasing.text,
      ownerName: "Arek",
      context: [],
      model,
      timeoutMs: 10_000,
      threshold,
    });
    const choice =
      pick.kind === "action"
        ? `${pick.actionId}|${pick.aiKind}`
        : pick.kind === "escalate"
          ? "escalate"
          : `slack.${pick.kind}|do`;
    const subject = "subjectId" in pick ? pick.subjectId : null;
    const wanted = phrasing.subject ? ids[phrasing.subject] : null;
    if (choice !== phrasing.expected || (wanted && subject !== wanted)) {
      const confidence = pick.confidence.toFixed(2);
      misses.push({
        phrasing,
        got: `${choice} (${confidence}) subject ${subject ?? "none"}`,
      });
    }
  }
  return {
    accuracy: (phrasings.length - misses.length) / phrasings.length,
    misses,
  };
}
