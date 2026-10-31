import {
  defineServerModule,
  type ItemWriter,
  protectedProcedure,
  router,
  writeItems,
} from "@dlh/server";
import { z } from "zod";

const sampleRouter = router({
  create: protectedProcedure
    .input(z.object({ title: z.string() }))
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) =>
        w.createItem({ type: "sample", title: input.title }),
      ),
    ),
});

export type SampleRouter = typeof sampleRouter;

/** 4 projects, each containing 4 notes: 20 items. */
async function seed(w: ItemWriter): Promise<void> {
  for (let p = 1; p <= 4; p++) {
    const project = await w.createItem({
      type: "sample",
      title: `Sample project ${p}`,
    });
    for (let n = 1; n <= 4; n++) {
      const note = await w.createItem({
        type: "sample",
        title: `Sample note ${p}.${n}`,
        searchText: `A note inside sample project ${p}.`,
      });
      await w.addLink({ fromId: project.id, toId: note.id, kind: "contains" });
    }
  }
}

export default defineServerModule({
  id: "sample",
  itemTypes: ["sample"],
  router: sampleRouter,
  seed,
});
