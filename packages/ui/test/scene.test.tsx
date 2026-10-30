import { act, render, screen } from "@testing-library/react";
import { GlassPanel } from "../src/glass/GlassPanel";
import { Scene } from "../src/scene/Scene";
import { sceneTransitionMs, sceneVariantFor } from "../src/scene/sceneVariant";

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m);

afterEach(() => vi.useRealTimers());

test.each([
  [at(4, 59), "night"],
  [at(5), "morning"],
  [at(11, 59), "morning"],
  [at(12), "morning"],
  [at(16, 59), "morning"],
  [at(17), "dusk"],
  [at(20, 59), "dusk"],
  [at(21), "night"],
  [at(0), "night"],
] as const)("%s → %s", (d, v) => expect(sceneVariantFor(d)).toBe(v));

test("clock changes fade slowly, picked ones quickly, reduced motion instantly", () => {
  expect(sceneTransitionMs(false)).toBe(60000);
  expect(sceneTransitionMs(false, "picked")).toBe(500);
  expect(sceneTransitionMs(true)).toBe(0);
  expect(sceneTransitionMs(true, "picked")).toBe(0);
});

const fades = () =>
  Array.from(
    screen.getByTestId("scene").children as HTMLCollectionOf<HTMLElement>,
  ).map((el) => el.style.transition);

test("picking a variant cross-fades quickly", () => {
  vi.useFakeTimers();
  vi.setSystemTime(at(9));
  const { rerender } = render(<Scene />);
  rerender(<Scene variant="night" />);
  expect(fades()).toEqual(["none", "opacity 500ms linear"]);
  rerender(<Scene />);
  expect(fades().at(-1)).toBe("opacity 500ms linear");
});

test("a clock change under no override cross-fades slowly", () => {
  vi.useFakeTimers();
  vi.setSystemTime(at(16, 59));
  render(<Scene />);
  act(() => {
    vi.setSystemTime(at(17, 0));
    vi.advanceTimersByTime(60_000);
  });
  expect(fades()).toEqual(["none", "opacity 60000ms linear"]);
});

test("switches variant when the clock crosses 17:00 without remount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(at(16, 59));
  render(<Scene />);
  const root = screen.getByTestId("scene");
  expect(root).toHaveAttribute("data-variant", "morning");
  act(() => {
    vi.setSystemTime(at(17, 0));
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId("scene")).toBe(root);
  expect(root).toHaveAttribute("data-variant", "dusk");
});

test("override wins over the clock", () => {
  vi.useFakeTimers();
  vi.setSystemTime(at(9));
  render(<Scene variant="night" />);
  expect(screen.getByTestId("scene")).toHaveAttribute("data-variant", "night");
  expect(screen.getByTestId("scene")).toHaveAttribute("aria-hidden", "true");
});

test("GlassPanel applies the recipe class", () => {
  render(<GlassPanel level="nav">x</GlassPanel>);
  expect(screen.getByText("x")).toHaveClass("glass-nav");
});
