import { items } from "@dlh/db";
import { eq } from "drizzle-orm";
import { itemContext, MAX_CONTEXT_CHARS } from "../src/ai/context";
import { writeItems } from "../src/items/writer";
import { freshTestDb, testDeps } from "../src/testing";

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { itemTypes: ["test"] });
  const mk = (title: string, searchText?: string) =>
    writeItems(deps, (w) => w.createItem({ type: "test", title, searchText }));
  return { db, deps, close, mk };
}

test("null item id gives an empty context", async () => {
  const { deps, close } = await setup();
  expect(await itemContext(deps, null)).toEqual({
    item: null,
    text: "",
    version: null,
  });
  await close();
});

test("includes title, body and both link directions", async () => {
  const { deps, close, mk } = await setup();
  const main = await mk("Review vendor contracts", "Check renewal dates");
  const child = await mk("Pull last year's contracts");
  const parent = await mk("Q4 planning");
  await writeItems(deps, (w) =>
    w.addLink({ fromId: main.id, toId: child.id, kind: "contains" }),
  );
  await writeItems(deps, (w) =>
    w.addLink({ fromId: parent.id, toId: main.id, kind: "contains" }),
  );
  const ctx = await itemContext(deps, main.id);
  expect(ctx.item?.id).toBe(main.id);
  expect(ctx.version).toBe(main.updatedAt);
  expect(ctx.text).toBe(
    [
      "Title: Review vendor contracts",
      "Type: test",
      `Id: ${main.id}`,
      "",
      "Body:",
      "Check renewal dates",
      "",
      "Links:",
      `- contains: Pull last year's contracts (id ${child.id})`,
      "Backlinks:",
      `- contains: Q4 planning (id ${parent.id})`,
    ].join("\n"),
  );
  await close();
});

test("omits empty sections", async () => {
  const { deps, close, mk } = await setup();
  const a = await mk("Solo");
  expect((await itemContext(deps, a.id)).text).toBe(
    `Title: Solo\nType: test\nId: ${a.id}`,
  );
  await close();
});

test("trims long bodies first and keeps the title", async () => {
  const { deps, close, mk } = await setup();
  const a = await mk("Big note", "x".repeat(20_000));
  const b = await mk("Linked");
  await writeItems(deps, (w) =>
    w.addLink({ fromId: a.id, toId: b.id, kind: "relates" }),
  );
  const { text } = await itemContext(deps, a.id);
  expect(text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  expect(text).toContain("Title: Big note");
  expect(text).toContain("…");
  expect(text).toContain(`- relates: Linked (id ${b.id})`);
  await close();
});

test("drops link lines from the end once the body is gone", async () => {
  const { deps, close, mk } = await setup();
  const a = await mk("Hub");
  const ids: string[] = [];
  for (let i = 0; i < 100; i++) {
    const t = await mk(`${String(i).padStart(3, "0")}${"y".repeat(200)}`);
    ids.push(t.id);
    await writeItems(deps, (w) =>
      w.addLink({ fromId: a.id, toId: t.id, kind: "mentions" }),
    );
  }
  const { text } = await itemContext(deps, a.id);
  expect(text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  expect(text.startsWith(`Title: Hub\nType: test\nId: ${a.id}`)).toBe(true);
  expect(text).toContain(`- mentions: 000${"y".repeat(200)} (id ${ids[0]})`);
  expect(text).not.toContain("- mentions: 099");
  // Every link line that survives keeps its id.
  for (const l of text.split("\n").filter((l) => l.startsWith("- "))) {
    expect(l).toMatch(/ \(id [0-9a-f-]{36}\)$/);
  }
  await close();
});

test("gives the ids of the item and every linked item", async () => {
  const { deps, close, mk } = await setup();
  const main = await mk("Main");
  const other = await mk("Other");
  await writeItems(deps, (w) =>
    w.addLink({ fromId: other.id, toId: main.id, kind: "mentions" }),
  );
  const { text } = await itemContext(deps, main.id);
  expect(text).toContain(`Id: ${main.id}`);
  expect(text).toContain(`(id ${other.id})`);
  await close();
});

test("deleted item is NOT_FOUND", async () => {
  const { db, deps, close, mk } = await setup();
  const a = await mk("Gone");
  const [row] = await db.select().from(items).where(eq(items.id, a.id));
  await writeItems(deps, (w) =>
    w.setDeleted({
      id: a.id,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      deleted: true,
    }),
  );
  await expect(itemContext(deps, a.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await close();
});
