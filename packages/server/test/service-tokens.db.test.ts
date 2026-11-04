import { describeOperation } from "@dlh/core";
import { serviceTokens } from "@dlh/db";
import { z } from "zod";
import {
  defineServerModule,
  findServiceToken,
  hashToken,
  implementOperation,
  mintRunToken,
  mintWorkerToken,
  type Principal,
  revokeRunTokens,
} from "../src";
import { freshTestDb, testServer } from "../src/testing";

const read = (id: string, extra: object) =>
  describeOperation({
    id,
    kind: "query",
    label: id,
    description: "x",
    appliesTo: "none",
    input: z.object({}),
    subject: () => null,
    effects: [],
    summary: () => id,
    ...extra,
  });

/** One operation of each access. */
const accessServer = defineServerModule({
  id: "acc",
  itemTypes: [],
  operations: {
    open: implementOperation(read("acc.open", {}), {
      run: async () => "open",
    }),
    mine: implementOperation(read("acc.mine", { access: "user" }), {
      run: async () => "mine",
    }),
    work: implementOperation(
      read("acc.work", { access: "worker", palette: false, ai: false }),
      { run: async () => "work" },
    ),
  },
});

async function setup() {
  const t = await freshTestDb();
  const as = (principal: Principal | null) =>
    testServer(t.db, [accessServer], { principal }).caller.acc;
  const principalOf = async (token: string) => {
    const p = await findServiceToken(t.db, token);
    if (!p) throw new Error("token not found");
    return p;
  };
  const runToken = (runId: string) =>
    t.db.transaction((tx) => mintRunToken(tx, runId));
  return { ...t, as, principalOf, runToken };
}

const RUN_ID = "0190a000-0000-7000-8000-000000000001";

test("a worker token calls only worker operations", async () => {
  const { as, principalOf, db, close } = await setup();
  const worker = await principalOf(await mintWorkerToken(db));
  expect(worker.kind).toBe("worker");
  expect(await as(worker).work({})).toBe("work");
  await expect(as(worker).open({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(as(worker).mine({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await close();
});

test("a run token calls everyone operations", async () => {
  const { as, principalOf, runToken, close } = await setup();
  const run = await principalOf(await runToken(RUN_ID));
  expect(run).toMatchObject({ kind: "run", runId: RUN_ID });
  expect(await as(run).open({})).toBe("open");
  await close();
});

test("a run token is refused by user and worker operations", async () => {
  const { as, principalOf, runToken, close } = await setup();
  const run = await principalOf(await runToken(RUN_ID));
  await expect(as(run).mine({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(as(run).work({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  await close();
});

test("a revoked run token is unauthorized", async () => {
  const { as, db, runToken, close } = await setup();
  const token = await runToken(RUN_ID);
  const other = await runToken("0190a000-0000-7000-8000-000000000002");
  await db.transaction((tx) => revokeRunTokens(tx, RUN_ID));
  const principal = await findServiceToken(db, token);
  expect(principal).toBeNull();
  await expect(as(principal).open({})).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(await findServiceToken(db, other)).not.toBeNull();
  expect(await findServiceToken(db, "unknown")).toBeNull();
  await close();
});

test("you are refused by worker operations", async () => {
  const { db, close } = await setup();
  const { caller } = testServer(db, [accessServer]);
  expect(await caller.acc.open({})).toBe("open");
  expect(await caller.acc.mine({})).toBe("mine");
  await expect(caller.acc.work({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await close();
});

test("only the hash is stored", async () => {
  const { db, runToken, close } = await setup();
  const worker = await mintWorkerToken(db);
  const run = await runToken(RUN_ID);
  expect(worker).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const rows = await db.select().from(serviceTokens);
  expect(rows.map((r) => r.tokenHash).sort()).toEqual(
    [hashToken(worker), hashToken(run)].sort(),
  );
  const stored = JSON.stringify(rows);
  expect(stored).not.toContain(worker);
  expect(stored).not.toContain(run);
  await close();
});

test("ops.undo refuses worker and run tokens", async () => {
  const { db, principalOf, runToken, close } = await setup();
  const worker = await principalOf(await mintWorkerToken(db));
  const run = await principalOf(await runToken(RUN_ID));
  for (const principal of [worker, run]) {
    const { caller } = testServer(db, [accessServer], { principal });
    await expect(
      caller.ops.undo({
        id: "acc.open",
        token: { record: null, created: [], calls: [] },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  await close();
});
