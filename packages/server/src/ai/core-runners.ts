import { coreAiActions, itemTitle } from "@dlh/core";
import { z } from "zod";
import { itemContext } from "./context";
import { type AiRunner, defineAiRunner } from "./runners";

const PREAMBLE =
  "You work inside a personal tasks-and-notes app. The person's request is your instruction. " +
  "The item they are working on, if any, is given between <item> tags. " +
  "Return only JSON matching the schema, with no other text.";

const answer = defineAiRunner(coreAiActions.answer, {
  context: itemContext,
  system: `${PREAMBLE}
Answer the person's question or explain what they asked about, using the item and its links as context. Be concise and plain. In "used", list the ids of any items you relied on (empty if none).`,
  output: {
    ask: z
      .object({
        answer: z.string().max(4000),
        used: z.array(z.uuid()).max(10),
      })
      .strict(),
  },
});

const undoRecord = z.object({
  id: z.string(),
  updatedAt: z.string(),
  title: z.string(),
});

const retitle = defineAiRunner(coreAiActions.retitle, {
  context: itemContext,
  system: `${PREAMBLE}
Write a clearer, more specific title for the item. When asked to suggest, give three distinct options, each with a one-sentence reason. When asked to do it, give one title.`,
  output: {
    suggest: z
      .object({
        options: z
          .array(
            z
              .object({ title: itemTitle, reason: z.string().max(200) })
              .strict(),
          )
          .length(3),
      })
      .strict(),
    do: z.object({ title: itemTitle }).strict(),
  },
  async apply(w, out, ctx) {
    const { title } = out as { title: string };
    const old = ctx.item?.title ?? "";
    const item = await w.updateItem?.({
      id: ctx.item?.id ?? "",
      expectedUpdatedAt: ctx.version ?? "",
      title,
    });
    if (!item) throw new Error("retitle needs updateItem");
    return { id: item.id, title: old, updatedAt: item.updatedAt };
  },
  async undo(w, record) {
    const r = undoRecord.parse(record);
    await w.updateItem?.({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      title: r.title,
    });
  },
  summary: (out) => `Renamed to “${(out as { title: string }).title}”`,
});

const deleteUndo = z.object({ id: z.string(), updatedAt: z.string() });

const del = defineAiRunner(coreAiActions.delete, {
  context: itemContext,
  system: `${PREAMBLE}
Describe in one sentence what would be deleted, so the person can confirm it.`,
  output: {
    suggest: z
      .object({
        options: z
          .array(z.object({ summary: z.string().max(200) }).strict())
          .length(1),
      })
      .strict(),
  },
  async apply(w, _out, ctx) {
    const item = await w.setDeleted?.({
      id: ctx.item?.id ?? "",
      expectedUpdatedAt: ctx.version ?? "",
      deleted: true,
    });
    if (!item) throw new Error("delete needs setDeleted");
    return { id: item.id, updatedAt: item.updatedAt };
  },
  async undo(w, record) {
    const r = deleteUndo.parse(record);
    await w.setDeleted?.({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      deleted: false,
    });
  },
  summary: (_out, ctx) => `Deleted “${ctx.item?.title ?? ""}”`,
});

export const coreAiRunners: AiRunner[] = [answer, retitle, del];
