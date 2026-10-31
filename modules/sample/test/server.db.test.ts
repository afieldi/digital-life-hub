import { writeItems } from "@dlh/server";
import { expectTracked, freshTestDb, testDeps } from "@dlh/server/testing";
import { TRPCError } from "@trpc/server";
import { expect, test } from "vitest";
import sampleServer from "../src/server";

async function setup() {
  const t = await freshTestDb();
  const deps = testDeps(t.db, { itemTypes: ["sample"] });
  const caller = sampleServer.router.createCaller({
    deps,
    session: { id: "s", email: "e" },
  });
  return { ...t, deps, caller };
}

test("create trims the title and makes a sample item", async () => {
  const { caller, close } = await setup();
  const item = await caller.create({ title: " Hello " });
  expect(item.title).toBe("Hello");
  expect(item.type).toBe("sample");
  expect(item.archivedAt).toBeNull();
  await close();
});

test("create publishes the new item", async () => {
  const { caller, deps, close } = await setup();
  await expectTracked(deps, {}, () => caller.create({ title: "Tracked" }));
  await close();
});

test("a blank title is BAD_REQUEST", async () => {
  const { caller, close } = await setup();
  const err = await caller.create({ title: "   " }).catch((e) => e);
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("BAD_REQUEST");
  await close();
});

test("seed creates 20 sample items and some contains links", async () => {
  const { db, deps, close } = await setup();
  const seed = sampleServer.seed;
  if (!seed) throw new Error("sample module has no seed");
  await writeItems(deps, seed);
  const [{ n }] = await db.$client<
    { n: number }[]
  >`select count(*)::int as n from items where type = 'sample'`;
  expect(n).toBe(20);
  const [{ c }] = await db.$client<
    { c: number }[]
  >`select count(*)::int as c from links where kind = 'contains'`;
  expect(c).toBeGreaterThan(0);
  await close();
});
