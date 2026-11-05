import { expect, test } from "vitest";
import { decision, pending, report } from "../src/schema";

test("pending needs requestId, seq and kind", () => {
  const requestId = "0198f1c2-0000-7000-8000-000000000001";
  expect(pending.safeParse({ requestId, seq: 1 }).success).toBe(false);
  expect(pending.safeParse({ seq: 1, kind: "approval" }).success).toBe(false);
  expect(pending.safeParse({ requestId, kind: "approval" }).success).toBe(
    false,
  );
  expect(pending.safeParse({ requestId, seq: 1, kind: "other" }).success).toBe(
    false,
  );
  expect(
    pending.parse({
      requestId,
      seq: 1,
      kind: "grant",
      connectionId: "0198f1c2-0000-7000-8000-000000000002",
    }).kind,
  ).toBe("grant");
});

test("decision has seq, approve and delivered", () => {
  expect(decision.safeParse({ seq: 1, approve: true }).success).toBe(false);
  expect(decision.parse({ seq: 1, approve: false, delivered: false })).toEqual({
    seq: 1,
    approve: false,
    delivered: false,
  });
});

test("report parses the spec's shape", () => {
  const r = {
    summary: "Fixed it",
    links: [{ label: "PR", url: "https://github.com/x/y/pull/1" }],
    filesChanged: ["a.ts"],
  };
  expect(report.parse(r)).toEqual(r);
  expect(report.safeParse({ summary: "x" }).success).toBe(false);
});
