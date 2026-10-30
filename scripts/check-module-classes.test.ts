import { expect, test } from "vitest";
import { findViolations } from "./check-module-classes";

test("layout classes pass", () =>
  expect(
    findViolations('<div className="flex gap-4 grid-cols-2 p-6" />', "a.tsx"),
  ).toEqual([]));

test("colour, type and glass classes fail", () => {
  const v = findViolations(
    '<div className="flex bg-white text-lg font-bold backdrop-blur" />',
    "a.tsx",
  );
  expect(v.map((x) => x.className)).toEqual([
    "bg-white",
    "text-lg",
    "font-bold",
    "backdrop-blur",
  ]);
});

test("text alignment is allowed", () =>
  expect(findViolations('<p className="text-center" />', "a.tsx")).toEqual([]));

test("arbitrary colour values fail", () =>
  expect(
    findViolations('<div className="p-[12px] [color:#fff]" />', "a.tsx").map(
      (x) => x.className,
    ),
  ).toEqual(["[color:#fff]"]));

test("variant prefixes do not hide violations", () => {
  const v = findViolations(
    '<div className="hover:bg-red-500 md:text-center data-[x=y]:rounded-lg md:flex" />',
    "a.tsx",
  );
  expect(v.map((x) => x.className)).toEqual([
    "hover:bg-red-500",
    "data-[x=y]:rounded-lg",
  ]);
});

test("expression and template literal forms are checked, with line numbers", () => {
  const src = [
    '<a className={"flex"} />',
    "<b className={'shadow-md'} />",
    "<c className={`p-2 opacity-50`} />",
    "<d className={`p-2 $" + "{x}`} />",
  ].join("\n");
  const v = findViolations(src, "a.tsx");
  expect(v.map((x) => [x.line, x.className])).toEqual([
    [2, "shadow-md"],
    [3, "opacity-50"],
  ]);
});
