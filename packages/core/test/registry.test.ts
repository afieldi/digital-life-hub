import {
  collectModules,
  defineModule,
  type ModuleManifest,
  ModuleRegistryError,
} from "../src";

const m = (id: string, nav?: Partial<ModuleManifest["nav"]>) =>
  defineModule({
    id,
    routes: () => [],
    nav: nav && { label: id, icon: "Box", path: `/${id}`, order: 0, ...nav },
  });
const it = (id: string, type: string) =>
  defineModule({
    id,
    routes: () => [],
    itemType: {
      type,
      label: type,
      glyph: "x",
      color: "red",
      href: (i) => `/${i}`,
    },
  });

test("nav is sorted by order", () =>
  expect(
    collectModules([m("b", { order: 2 }), m("a", { order: 1 })]).nav.map(
      (n) => n.label,
    ),
  ).toEqual(["a", "b"]));
test("duplicate module ids throw", () =>
  expect(() => collectModules([m("a"), m("a")])).toThrow(ModuleRegistryError));
test("duplicate nav paths throw", () =>
  expect(() =>
    collectModules([m("a", { path: "/x" }), m("b", { path: "/x" })]),
  ).toThrow(/\/x/));
test("duplicate g-keys throw", () =>
  expect(() =>
    collectModules([m("a", { key: "t" }), m("b", { key: "t" })]),
  ).toThrow(/g t/));
test("duplicate item types throw", () =>
  expect(() => collectModules([it("a", "note"), it("b", "note")])).toThrow(
    /note/,
  ));
test("item types are keyed by type", () =>
  expect([...collectModules([it("a", "note")]).itemTypes.keys()]).toEqual([
    "note",
  ]));
test("modules without nav still contribute actions", () => {
  const r = collectModules([
    defineModule({
      id: "x",
      routes: () => [],
      paletteActions: [{ id: "x.a", label: "Do", group: "actions", run() {} }],
    }),
  ]);
  expect(r.nav).toEqual([]);
  expect(r.actions.map((a) => a.id)).toEqual(["x.a"]);
});

const act = (id: string, actionId: string) =>
  defineModule({
    id,
    routes: () => [],
    paletteActions: [{ id: actionId, label: "Do", group: "actions", run() {} }],
  });

test("reserved nav keys throw", () =>
  expect(() => collectModules([m("a", { key: "h" })], { keys: ["h"] })).toThrow(
    /reserved.*"h"|"h".*reserved/,
  ));
test("reserved nav paths throw", () =>
  expect(() =>
    collectModules([m("a", { path: "/settings" })], { paths: ["/settings"] }),
  ).toThrow(/\/settings/));
test("non-reserved key and path pass", () =>
  expect(() =>
    collectModules([m("a", { key: "j", path: "/a" })], {
      keys: ["h"],
      paths: ["/"],
    }),
  ).not.toThrow());
test("nav keys must be a single lowercase letter", () => {
  for (const key of ["H", "ab", "1", ""])
    expect(() => collectModules([m("a", { key })])).toThrow(/invalid nav key/);
});
test("duplicate palette action ids across modules throw", () =>
  expect(() =>
    collectModules([act("a", "same.id"), act("b", "same.id")]),
  ).toThrow(/same\.id/));
