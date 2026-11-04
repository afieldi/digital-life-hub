import { accessOf } from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import { expect, test } from "vitest";
import { agentOps } from "../src/operations";

const WORKER = [
  "claim",
  "heartbeat",
  "appendEvents",
  "takeMessages",
  "suspend",
  "finish",
  "fail",
  "registerConnection",
] as const;

test("every worker operation is worker-only and hidden from ⌘K and AI", () => {
  for (const key of WORKER) {
    const d = agentOps[key];
    expect({ key, access: accessOf(d), palette: d.palette, ai: d.ai }).toEqual({
      key,
      access: "worker",
      palette: false,
      ai: false,
    });
  }
});

test("no agent operation is callable by a run", () => {
  for (const [key, d] of Object.entries(agentOps)) {
    expect({ key, ok: ["user", "worker"].includes(accessOf(d)) }).toEqual({
      key,
      ok: true,
    });
  }
});

test("operations are keyed as they are mounted", () => {
  for (const [key, d] of Object.entries(agentOps)) {
    expect(d.id).toBe(`agent.${key}`);
  }
});

test("decide and retry declare requests.resolve", () => {
  expect(agentOps.decide.calls).toContain(requestOps.resolve);
  expect(agentOps.retry.calls).toContain(requestOps.resolve);
});

test("run actions and assignments declare touchItems", () => {
  for (const key of ["unassign", "cancel", "retry", "decide"] as const) {
    expect(agentOps[key].effects).toEqual(["touchItems"]);
  }
  for (const key of ["assign", "assignRequest"] as const) {
    expect(agentOps[key].effects).toEqual(["touchItems"]);
  }
});

test("worker operations that change a run's state touch items; heartbeat and claim declare their calls", () => {
  for (const key of [
    "claim",
    "heartbeat",
    "suspend",
    "finish",
    "fail",
  ] as const) {
    expect(agentOps[key].effects).toEqual(["touchItems"]);
  }
  expect(agentOps.heartbeat.calls).toEqual([taskOps.get, requestOps.file]);
  expect(agentOps.claim.calls).toEqual([
    taskOps.get,
    requestOps.get,
    requestOps.resolve,
  ]);
});
