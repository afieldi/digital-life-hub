import { describeOperation, type Item } from "@dlh/core";
import {
  coreRouters,
  defineServerModule,
  implementOperation,
  mountModules,
  router,
  type UndoToken,
} from "@dlh/server";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { z } from "zod";
import { type AppRouter, appRouter } from "../src/router";

const renameInput = z.object({
  id: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  title: z.string(),
  pinned: z.boolean().default(false),
});

const demo = defineServerModule({
  id: "demo",
  itemTypes: ["demo"],
  operations: {
    rename: implementOperation(
      describeOperation({
        id: "demo.rename",
        kind: "mutation",
        label: "Rename",
        description: "Rename the demo.",
        appliesTo: ["demo"],
        input: renameInput,
        subject: (i) => i.id,
        effects: ["updateItem"],
        summary: (i) => `Rename to ${i.title}`,
      }),
      {
        run: async (w, input) => {
          const item = await w.updateItem?.(input);
          if (!item) throw new Error("no writer");
          return { result: item, undo: { title: "old" } };
        },
        undo: async () => {},
        undoRecord: z.object({ title: z.string() }),
      },
    ),
    count: implementOperation(
      describeOperation({
        id: "demo.count",
        kind: "query",
        label: "Count",
        description: "Count demos.",
        appliesTo: "none",
        input: z.object({ max: z.number().optional() }),
        subject: () => null,
        effects: [],
        summary: () => "Count",
        palette: false,
      }),
      { run: async () => 3 },
    ),
  },
});

// Built like AppRouter, with a module that has operations.
const local = router({ ...coreRouters, ...mountModules([demo] as const) });
type LocalIn = inferRouterInputs<typeof local>;
type LocalOut = inferRouterOutputs<typeof local>;
type AppIn = inferRouterInputs<AppRouter>;
type AppOut = inferRouterOutputs<AppRouter>;

test("a module operation keeps its input and output types", () => {
  expectTypeOf<LocalIn["demo"]["rename"]>().toEqualTypeOf<
    z.input<typeof renameInput>
  >();
  expectTypeOf<LocalOut["demo"]["rename"]["result"]>().toEqualTypeOf<Item>();
  // The token a client receives is what ops.undo takes back.
  expectTypeOf<LocalOut["demo"]["rename"]["undo"]>().toExtend<
    AppIn["ops"]["undo"]["token"]
  >();
  expectTypeOf<UndoToken>().toExtend<AppIn["ops"]["undo"]["token"]>();
  expectTypeOf<LocalIn["demo"]["count"]>().toEqualTypeOf<{ max?: number }>();
  expectTypeOf<LocalOut["demo"]["count"]>().toEqualTypeOf<number>();
  expectTypeOf<
    (typeof local)["demo"]["rename"]["_def"]["type"]
  >().toEqualTypeOf<"mutation">();
  expectTypeOf<
    (typeof local)["demo"]["count"]["_def"]["type"]
  >().toEqualTypeOf<"query">();
  expect(Object.keys(local._def.procedures)).toEqual(
    expect.arrayContaining(["demo.rename", "demo.count", "ops.undo"]),
  );
});

test("existing AppRouter procedures keep their types", () => {
  expectTypeOf<AppIn["items"]["rename"]>().toEqualTypeOf<{
    id: string;
    expectedUpdatedAt: string;
    title: string;
  }>();
  expectTypeOf<AppOut["items"]["rename"]>().toEqualTypeOf<Item>();
  expectTypeOf<AppIn["sample"]["create"]>().toEqualTypeOf<{ title: string }>();
  expectTypeOf<AppIn["ops"]["undo"]>().toEqualTypeOf<{
    id: string;
    token: { record?: unknown; created: string[] };
  }>();
  expectTypeOf<AppOut["ops"]["undo"]>().toEqualTypeOf<{ summary: string }>();
  expect(Object.keys(appRouter._def.procedures)).toContain("ops.undo");
});

test("tasks operations are typed on the real AppRouter", () => {
  expectTypeOf<AppIn["tasks"]["complete"]>().toEqualTypeOf<{
    id: string;
    expectedUpdatedAt: string;
  }>();
  expectTypeOf<
    AppOut["tasks"]["complete"]["result"]["task"]
  >().toEqualTypeOf<Item>();
  expect(Object.keys(appRouter._def.procedures)).toContain("tasks.complete");
});
