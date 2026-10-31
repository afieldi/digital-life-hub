import { createChangeBus } from "../src/changes";

describe("change bus", () => {
  it("delivers deduped ids in order of first appearance", () => {
    const bus = createChangeBus();
    const got: string[][] = [];
    bus.subscribe((ids) => got.push(ids));
    bus.publish(["a", "b", "a"]);
    expect(got).toEqual([["a", "b"]]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createChangeBus();
    const got: string[][] = [];
    const off = bus.subscribe((ids) => got.push(ids));
    expect(bus.size()).toBe(1);
    off();
    expect(bus.size()).toBe(0);
    bus.publish(["a"]);
    expect(got).toEqual([]);
  });

  it("calls no one for an empty publish", () => {
    const bus = createChangeBus();
    const got: string[][] = [];
    bus.subscribe((ids) => got.push(ids));
    bus.publish([]);
    expect(got).toEqual([]);
  });

  it("a throwing subscriber does not stop the others or throw", () => {
    const bus = createChangeBus();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const got: string[][] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((ids) => got.push(ids));
    expect(() => bus.publish(["a"])).not.toThrow();
    expect(got).toEqual([["a"]]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
