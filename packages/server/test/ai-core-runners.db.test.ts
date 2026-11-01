import { coreAiRunners, scopedWriter, writeItems } from "../src";
import { itemContext } from "../src/ai/context";
import { freshTestDb, testDeps } from "../src/testing";

const runner = (id: string) => {
  const r = coreAiRunners.find((x) => x.action.id === id);
  if (!r) throw new Error(`no runner ${id}`);
  return r;
};

function need<T>(f: T | undefined): T {
  if (!f) throw new Error("runner method missing");
  return f;
}

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { itemTypes: ["test"] });
  let t = new Date("2026-10-30T12:00:00.000Z").getTime();
  // The test clock is frozen; advance it before each write so updated_at moves.
  const tick = () => {
    t += 1000;
    deps.setNow(new Date(t));
  };
  tick();
  const item = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "Old" }),
  );
  return { deps, item, tick, close };
}

test("retitle apply renames and undo restores", async () => {
  const { deps, item, tick, close } = await setup();
  const r = runner("retitle");
  const ctx = await itemContext(deps, item.id);
  tick();
  const record = await writeItems(deps, (w) =>
    need(r.apply).call(
      r,
      scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
      { title: "New" },
      ctx,
    ),
  );
  expect((await itemContext(deps, item.id)).item?.title).toBe("New");
  tick();
  await writeItems(deps, (w) =>
    need(r.undo).call(
      r,
      scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
      record,
    ),
  );
  expect((await itemContext(deps, item.id)).item?.title).toBe("Old");
  await close();
});

test("retitle undo after an intervening edit conflicts", async () => {
  const { deps, item, tick, close } = await setup();
  const r = runner("retitle");
  const ctx = await itemContext(deps, item.id);
  tick();
  const record = await writeItems(deps, (w) =>
    need(r.apply).call(
      r,
      scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
      { title: "New" },
      ctx,
    ),
  );
  const mid = await itemContext(deps, item.id);
  tick();
  await writeItems(deps, (w) =>
    w.updateItem({
      id: item.id,
      expectedUpdatedAt: mid.version as string,
      title: "Edited",
    }),
  );
  tick();
  await expect(
    writeItems(deps, (w) =>
      need(r.undo).call(
        r,
        scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
        record,
      ),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await close();
});

test("undo rejects a malformed record", async () => {
  const { deps, item, tick, close } = await setup();
  const r = runner("retitle");
  tick();
  await expect(
    writeItems(deps, (w) =>
      need(r.undo).call(
        r,
        scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
        { nope: 1 },
      ),
    ),
  ).rejects.toThrow();
  await close();
});

test("delete apply soft-deletes and undo restores", async () => {
  const { deps, item, tick, close } = await setup();
  const r = runner("delete");
  const ctx = await itemContext(deps, item.id);
  tick();
  const record = await writeItems(deps, (w) =>
    need(r.apply).call(
      r,
      scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
      {},
      ctx,
    ),
  );
  await expect(itemContext(deps, item.id)).rejects.toBeDefined();
  tick();
  await writeItems(deps, (w) =>
    need(r.undo).call(
      r,
      scopedWriter(w, { effects: r.action.effects, itemId: item.id }),
      record,
    ),
  );
  expect((await itemContext(deps, item.id)).item?.title).toBe("Old");
  await close();
});
