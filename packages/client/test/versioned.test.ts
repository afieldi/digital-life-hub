import { queueVersioned, queueVersionedMany } from "../src";

/** A promise to resolve by hand, to hold a write in flight. */
function held<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("writes to one item run in order, each with the version the last one got back", async () => {
  const sent: string[] = [];
  const first = held<{ updatedAt: string }>();
  const a = queueVersioned("i1", "v1", (v) => {
    sent.push(v);
    return first.promise;
  });
  // Queued while the first is in flight, from a cache that still says v1.
  const b = queueVersioned("i1", "v1", async (v) => {
    sent.push(v);
    return { updatedAt: "v3" };
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent).toEqual(["v1"]);
  first.resolve({ updatedAt: "v2" });
  await a;
  await b;
  expect(sent).toEqual(["v1", "v2"]);
});

test("an operation's { result } carries the version; a failure doesn't block the next write", async () => {
  const sent: string[] = [];
  await queueVersioned("i2", "v1", async () => ({
    result: { updatedAt: "v2" },
  }));
  await expect(
    queueVersioned("i2", "v1", async (v) => {
      sent.push(v);
      throw new Error("conflict");
    }),
  ).rejects.toThrow("conflict");
  await queueVersioned("i2", "v1", async (v) => {
    sent.push(v);
    return null;
  });
  expect(sent).toEqual(["v2", "v2"]);
});

test("a write to several items waits for each and sends each one's newest version", async () => {
  const one = held<{ updatedAt: string }>();
  const order: string[] = [];
  const single = queueVersioned("m1", "a1", async () => {
    order.push("single");
    return one.promise;
  });
  const many = queueVersionedMany(
    [
      { id: "m1", seen: "a1" },
      { id: "m2", seen: "b1" },
    ],
    async (versions) => {
      order.push("many");
      expect(versions).toEqual([
        { id: "m1", expectedUpdatedAt: "a2" },
        { id: "m2", expectedUpdatedAt: "b1" },
      ]);
      return [
        { id: "m1", updatedAt: "a3" },
        { id: "m2", updatedAt: "b2" },
      ];
    },
    (items) => items,
  );
  await new Promise((r) => setTimeout(r, 0));
  expect(order).toEqual(["single"]);
  one.resolve({ updatedAt: "a2" });
  await single;
  await many;
  const after: string[] = [];
  await queueVersioned("m2", "b1", async (v) => {
    after.push(v);
    return null;
  });
  expect(after).toEqual(["b2"]);
});
