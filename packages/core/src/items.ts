import { z } from "zod";

export const linkKind = z.enum(["contains", "mentions", "relates"]);
export type LinkKind = z.infer<typeof linkKind>;

export const itemTitle = z.string().trim().min(1).max(500);

export const item = z.object({
  id: z.uuid(),
  type: z.string(),
  title: itemTitle,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});
export type Item = z.infer<typeof item>;

export const itemSummary = item.pick({
  id: true,
  type: true,
  title: true,
  archivedAt: true,
});
export type ItemSummary = z.infer<typeof itemSummary>;

export const link = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  kind: linkKind,
  context: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Link = z.infer<typeof link>;

export const listCursor = z.object({
  updatedAt: z.iso.datetime(),
  id: z.uuid(),
});
export type ListCursor = z.infer<typeof listCursor>;
