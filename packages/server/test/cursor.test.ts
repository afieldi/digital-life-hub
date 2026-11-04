import { z } from "zod";
import { opaqueCursor } from "../src";

const cursor = opaqueCursor(z.object({ t: z.iso.datetime(), id: z.uuid() }));
const at = {
  t: "2026-11-02T09:00:00.000Z",
  id: "0197a000-0000-7000-8000-000000000001",
};

test("a cursor round-trips and is opaque to the client", () => {
  const c = cursor.encode(at);
  expect(c).not.toContain("2026");
  expect(cursor.decode(c)).toEqual(at);
});

test("anything else is a BAD_REQUEST", () => {
  for (const bad of ["nope", cursor.encode({ ...at, id: "x" }), ""]) {
    expect(() => cursor.decode(bad), bad).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  }
});
