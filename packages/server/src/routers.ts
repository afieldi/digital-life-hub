import { item, itemSummary, link, linkKind, listCursor } from "@dlh/core";
import { z } from "zod";
import { getItem, linksForItem, listContained, listItems } from "./items/read";
import { listRecents, recordView } from "./items/recents";
import { searchItems } from "./items/search";
import { writeItems } from "./items/writer";
import { protectedProcedure, router } from "./trpc";

const id = z.uuid();
const versioned = z.object({ id, expectedUpdatedAt: z.iso.datetime() });
const linkWithItem = link.extend({ item: itemSummary });
const ok = z.object({ ok: z.literal(true) });

const items = router({
  get: protectedProcedure
    .input(z.object({ id }))
    .output(item)
    .query(({ ctx, input }) => getItem(ctx.deps.db, input.id)),

  list: protectedProcedure
    .input(
      z.object({
        types: z.array(z.string()).optional(),
        includeArchived: z.boolean().optional(),
        cursor: listCursor.optional(),
        limit: z.number().int().optional(),
      }),
    )
    .output(
      z.object({ items: z.array(item), nextCursor: listCursor.nullable() }),
    )
    .query(({ ctx, input }) => listItems(ctx.deps.db, input)),

  rename: protectedProcedure
    .input(versioned.extend({ title: z.string() }))
    .output(item)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.updateItem(input)),
    ),

  archive: protectedProcedure
    .input(versioned)
    .output(item)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.setArchived({ ...input, archived: true })),
    ),

  unarchive: protectedProcedure
    .input(versioned)
    .output(item)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.setArchived({ ...input, archived: false })),
    ),

  delete: protectedProcedure
    .input(versioned)
    .output(item)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.setDeleted({ ...input, deleted: true })),
    ),

  restore: protectedProcedure
    .input(versioned)
    .output(item)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.setDeleted({ ...input, deleted: false })),
    ),
});

const links = router({
  add: protectedProcedure
    .input(
      z.object({
        fromId: id,
        toId: id,
        kind: linkKind,
        context: z.string().max(2000).nullable().optional(),
      }),
    )
    .output(link)
    .mutation(({ ctx, input }) =>
      writeItems(ctx.deps, (w) => w.addLink(input)),
    ),

  remove: protectedProcedure
    .input(z.object({ id }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      await writeItems(ctx.deps, (w) => w.removeLink(input.id));
      return { ok: true as const };
    }),

  forItem: protectedProcedure
    .input(z.object({ id }))
    .output(
      z.object({
        outgoing: z.array(linkWithItem),
        backlinks: z.array(linkWithItem),
      }),
    )
    .query(async ({ ctx, input }) => {
      await getItem(ctx.deps.db, input.id);
      return linksForItem(ctx.deps.db, input.id);
    }),

  contained: protectedProcedure
    .input(z.object({ id }))
    .output(z.array(z.object({ item: itemSummary, via: itemSummary })))
    .query(async ({ ctx, input }) => {
      await getItem(ctx.deps.db, input.id);
      return listContained(ctx.deps.db, input.id);
    }),
});

const search = protectedProcedure
  .input(
    z.object({
      query: z.string().max(1000),
      types: z.array(z.string()).optional(),
      limit: z.number().int().optional(),
    }),
  )
  .output(z.array(itemSummary))
  .query(({ ctx, input }) => searchItems(ctx.deps.db, input));

const recents = router({
  list: protectedProcedure
    .output(z.array(itemSummary))
    .query(({ ctx }) => listRecents(ctx.deps.db)),

  record: protectedProcedure
    .input(z.object({ id }))
    .output(ok)
    .mutation(async ({ ctx, input }) => {
      await recordView(ctx.deps, input.id);
      return { ok: true as const };
    }),
});

export const coreRouters = { items, links, search, recents };
export type CoreRouter = ReturnType<typeof router<typeof coreRouters>>;
