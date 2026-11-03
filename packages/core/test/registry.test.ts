import {
  collectModules,
  defineModule,
  describeModule,
  ModuleDescriptionError,
  type ModuleManifest,
  ModuleRegistryError,
  modulesShowing,
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

const Widget = () => null;

describe("Home widgets", () => {
  const w = (id: string, order?: number) => ({
    id,
    label: id,
    component: Widget,
    ...(order === undefined ? {} : { order }),
  });
  const withWidgets = (id: string, homeWidgets: ReturnType<typeof w>[]) =>
    defineModule({ id, routes: () => [], homeWidgets });

  test("are gathered across modules, ids prefixed, in order then registry order", () => {
    const { homeWidgets } = collectModules([
      withWidgets("tasks", [w("later"), w("today", 1)]),
      withWidgets("requests", [w("needsYou", 2), w("other")]),
    ]);
    expect(homeWidgets.map((x) => x.id)).toEqual([
      "tasks.today",
      "requests.needsYou",
      "tasks.later",
      "requests.other",
    ]);
  });

  test("a duplicate id within a module throws", () =>
    expect(() =>
      collectModules([withWidgets("tasks", [w("a"), w("a")])]),
    ).toThrow(ModuleRegistryError));

  test("the same id in two modules is fine", () =>
    expect(
      collectModules([withWidgets("a", [w("x")]), withWidgets("b", [w("x")])])
        .homeWidgets,
    ).toHaveLength(2));
});

test("a module may own / when the shell doesn't reserve it", () =>
  expect(
    collectModules([m("home", { path: "/", key: "h" })], {
      paths: ["/settings"],
    }).nav.map((n) => n.path),
  ).toEqual(["/"]));

test("a manifest from a description takes its id and operations, and must show a declared item type", () => {
  const desc = describeModule({ id: "notes", itemTypes: ["note"] });
  const manifest = defineModule(desc, {
    routes: () => [],
    itemType: {
      type: "note",
      label: "Note",
      glyph: "x",
      color: "red",
      href: (i) => `/n/${i}`,
    },
  });
  expect(manifest).toMatchObject({
    id: "notes",
    operations: [],
    aiActions: [],
  });
  expect(() =>
    defineModule(desc, {
      routes: () => [],
      itemType: {
        type: "page",
        label: "Page",
        glyph: "x",
        color: "red",
        href: (i) => `/p/${i}`,
      },
    }),
  ).toThrow(ModuleDescriptionError);
});

test("modulesShowing: each type's owner and the modules that refresh on it", () => {
  const registry = {
    modules: [
      it("tasks", "task"),
      { ...it("requests", "request"), refreshOn: ["task"] },
      m("home"),
    ],
  };
  expect(modulesShowing(registry, ["request"])).toEqual(new Set(["requests"]));
  expect(modulesShowing(registry, ["task"])).toEqual(
    new Set(["tasks", "requests"]),
  );
  // A type no module owns: the caller can't tell, so null.
  expect(modulesShowing(registry, ["task", "ghost"])).toBeNull();
});
