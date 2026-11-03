import type { ItemWriter } from "@dlh/server";
import { requests } from "../db/schema";
import type { Outcome, Source } from "../schema";

type SeedRequest = {
  title: string;
  body?: string;
  fromName?: string;
  source: Source;
  sourceUrl?: string;
  externalId?: string;
  /** Hours before now that it was received. */
  hoursAgo: number;
  /** Resolved an hour after it was received. */
  outcome?: Exclude<Outcome, "task">;
};

const REQUESTS: SeedRequest[] = [
  {
    title: "Look at the insurance renewal letter",
    body: "It came in the post; the deadline is on page 2.",
    source: "manual",
    hoursAgo: 50,
  },
  {
    title: "Can you review the Q3 planning doc?",
    body: "Mostly the hiring section. No rush, before Thursday is fine.",
    fromName: "Maya Chen",
    source: "slack",
    sourceUrl: "https://example.slack.com/archives/C01PLAN/p1730500000000100",
    externalId: "C01PLAN:1730500000.000100",
    hoursAgo: 20,
  },
  {
    title: "Are you joining the offsite dinner?",
    body: "Need a headcount by Friday.",
    fromName: "Sam Ortiz",
    source: "slack",
    sourceUrl: "https://example.slack.com/archives/C02TEAM/p1730560000000200",
    externalId: "C02TEAM:1730560000.000200",
    hoursAgo: 3,
  },
  {
    title: "Send the signed lease back",
    fromName: "Priya Nair",
    source: "manual",
    hoursAgo: 72,
    outcome: "handled",
  },
  {
    title: "Weekly analytics digest",
    body: "Automated report for the growth team.",
    source: "ai",
    hoursAgo: 30,
    outcome: "not_for_me",
  },
];

const HOUR = 60 * 60 * 1000;

/**
 * Three open requests (one filed by hand, two from Slack), one handled and one
 * not for me. A request resolved as a task needs Tasks' `create`, which the
 * seed's writer can't call.
 */
export async function seed(w: ItemWriter): Promise<void> {
  const now = Date.now();
  for (const r of REQUESTS) {
    const item = await w.createItem({
      type: "request",
      title: r.title,
      searchText: [r.body, r.fromName].filter(Boolean).join("\n") || null,
    });
    const receivedAt = new Date(now - r.hoursAgo * HOUR);
    await w.tx.insert(requests).values({
      itemId: item.id,
      body: r.body ?? null,
      fromName: r.fromName ?? null,
      source: r.source,
      sourceUrl: r.sourceUrl ?? null,
      externalId: r.externalId ?? null,
      receivedAt,
      outcome: r.outcome ?? null,
      resolvedAt: r.outcome ? new Date(receivedAt.getTime() + HOUR) : null,
    });
  }
}
