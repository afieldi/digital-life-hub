import { describeOperation } from "@dlh/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { defineServerModule, implementOperation, type Principal } from "../src";
import { freshTestDb, testServer } from "../src/testing";

const ofRun = describeOperation({
  id: "rg.ofRun",
  kind: "query",
  label: "Of a run",
  description: "Reads something of one run.",
  appliesTo: "none",
  input: z.object({ runId: z.string() }),
  subject: () => null,
  effects: [],
  summary: () => "Of a run",
});

const open = describeOperation({
  id: "rg.open",
  kind: "query",
  label: "Open",
  description: "Reads something anyone may.",
  appliesTo: "none",
  input: z.object({ text: z.string() }),
  subject: () => null,
  effects: [],
  summary: () => "Open",
});

const callee = describeOperation({
  id: "rh.callee",
  kind: "query",
  label: "Callee",
  description: "Called by rg.caller.",
  appliesTo: "none",
  input: z.object({ text: z.string() }),
  subject: () => null,
  effects: [],
  summary: () => "Callee",
});

const caller = describeOperation({
  id: "rg.caller",
  kind: "mutation",
  label: "Caller",
  description: "Calls rh.callee.",
  appliesTo: "none",
  input: z.object({ text: z.string() }),
  subject: () => null,
  effects: [],
  summary: () => "Caller",
  calls: [callee],
});

/** Every call the guard saw, as `<runId> <operation> <input>`. */
const seen: string[] = [];

const rg = defineServerModule({
  id: "rg",
  itemTypes: [],
  operations: {
    ofRun: implementOperation(ofRun, { run: async (_d, i) => i.runId }),
    open: implementOperation(open, { run: async (_d, i) => i.text }),
    caller: implementOperation(caller, {
      run: async (w, input) => ({
        result: await w.call?.(callee, input),
        undo: null,
      }),
      undo: async () => {},
      undoRecord: z.null(),
    }),
  },
  runGuard: async (_deps, call) => {
    seen.push(
      `${call.runId} ${call.operation.desc.id} ${JSON.stringify(call.input)}`,
    );
    if ((call.input as { text?: string }).text === "refuse") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Needs approval" });
    }
  },
});

const rh = defineServerModule({
  id: "rh",
  itemTypes: [],
  operations: {
    callee: implementOperation(callee, { run: async (_d, i) => i.text }),
  },
});

const RUN: Principal = { kind: "run", tokenId: "t", runId: "run-1" };

async function setup() {
  seen.length = 0;
  const t = await freshTestDb();
  const as = (principal: Principal) =>
    testServer(t.db, [rg, rh], { principal }).caller;
  return { ...t, as };
}

test("a run token with another run's runId is forbidden", async () => {
  const { as, close } = await setup();
  await expect(as(RUN).rg.ofRun({ runId: "run-1" })).resolves.toBe("run-1");
  await expect(as(RUN).rg.ofRun({ runId: "run-2" })).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "Not this run",
  });
  // Identity comes before the guards: they never saw the forbidden call.
  expect(seen).toEqual(['run-1 rg.ofRun {"runId":"run-1"}']);
  // You may read any run's.
  await expect(
    as({ kind: "user", session: { id: "s", email: "a@x" } }).rg.ofRun({
      runId: "run-2",
    }),
  ).resolves.toBe("run-2");
  await close();
});

test("a run guard can refuse a run's call", async () => {
  const { as, close } = await setup();
  await expect(as(RUN).rg.open({ text: "fine" })).resolves.toBe("fine");
  await expect(as(RUN).rg.open({ text: "refuse" })).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "Needs approval",
  });
  // rg's guard sees rh's operations too: guards are for every run call.
  await expect(as(RUN).rh.callee({ text: "refuse" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(seen).toEqual([
    'run-1 rg.open {"text":"fine"}',
    'run-1 rg.open {"text":"refuse"}',
    'run-1 rh.callee {"text":"refuse"}',
  ]);
  await close();
});

test("guards don't run for you or for operation calls", async () => {
  const { as, close } = await setup();
  const you = as({ kind: "user", session: { id: "s", email: "a@x" } });
  await expect(you.rg.open({ text: "refuse" })).resolves.toBe("refuse");
  await expect(you.rg.caller({ text: "refuse" })).resolves.toMatchObject({
    result: "refuse",
  });
  expect(seen).toEqual([]);
  // A run's call is guarded once, for the operation it called, not its callee.
  await expect(as(RUN).rg.caller({ text: "ok" })).resolves.toMatchObject({
    result: "ok",
  });
  expect(seen).toEqual(['run-1 rg.caller {"text":"ok"}']);
  await close();
});
