import { type Item, itemTitle, type Link, type LinkKind } from "@dlh/core";
import { items } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import type { CoreDeps, Tx } from "../trpc";
import { deleteLink, insertLink } from "./links";

export interface ItemWriter {
  tx: Tx;
  createItem(i: {
    type: string;
    title: string;
    searchText?: string | null;
  }): Promise<Item>;
  updateItem(i: {
    id: string;
    expectedUpdatedAt: string;
    title?: string;
    searchText?: string | null;
  }): Promise<Item>;
  setArchived(i: {
    id: string;
    expectedUpdatedAt: string;
    archived: boolean;
  }): Promise<Item>;
  setDeleted(i: {
    id: string;
    expectedUpdatedAt: string;
    deleted: boolean;
  }): Promise<Item>;
  addLink(i: {
    fromId: string;
    toId: string;
    kind: LinkKind;
    context?: string | null;
  }): Promise<Link>;
  removeLink(id: string): Promise<void>;
}

type ItemRow = typeof items.$inferSelect;

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function parseTitle(title: string): string {
  const parsed = itemTitle.safeParse(title);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "title must be 1 to 500 characters",
    });
  }
  return parsed.data;
}

/**
 * Runs `fn` in one transaction. Ids of every item touched through the writer are
 * published to `deps.changes` only after the transaction commits.
 */
export async function writeItems<T>(
  deps: CoreDeps,
  fn: (w: ItemWriter) => Promise<T>,
): Promise<T> {
  const changed = new Set<string>();
  const result = await deps.db.transaction(async (tx) => {
    /** One statement: version check, soft-delete state check and the write. */
    async function mutate(
      id: string,
      expectedUpdatedAt: string,
      set: Partial<typeof items.$inferInsert>,
      wantDeleted: boolean,
    ): Promise<Item> {
      const expected = new Date(expectedUpdatedAt);
      if (Number.isNaN(expected.getTime())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "invalid expectedUpdatedAt",
        });
      }
      const now = deps.now().toISOString();
      const deletedCheck: SQL = wantDeleted
        ? isNotNull(items.deletedAt)
        : isNull(items.deletedAt);
      const [row] = await tx
        .update(items)
        .set({
          ...set,
          updatedAt: sql`greatest(${now}::timestamptz, ${items.updatedAt} + interval '1 millisecond')`,
        })
        .where(
          and(eq(items.id, id), eq(items.updatedAt, expected), deletedCheck),
        )
        .returning();
      if (!row) {
        const [existing] = await tx
          .select({ deletedAt: items.deletedAt })
          .from(items)
          .where(eq(items.id, id));
        const missing =
          !existing || (existing.deletedAt !== null) !== wantDeleted;
        throw new TRPCError(
          missing
            ? { code: "NOT_FOUND", message: "item not found" }
            : {
                code: "CONFLICT",
                message: "item was changed by someone else",
              },
        );
      }
      changed.add(id);
      return toItem(row);
    }

    const writer: ItemWriter = {
      tx,
      async createItem(i) {
        if (!deps.itemTypes.has(i.type)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `unknown item type: ${i.type}`,
          });
        }
        const now = deps.now();
        const [row] = await tx
          .insert(items)
          .values({
            type: i.type,
            title: parseTitle(i.title),
            searchText: i.searchText ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        changed.add(row.id);
        return toItem(row);
      },
      updateItem(i) {
        const set: Partial<typeof items.$inferInsert> = {};
        if (i.title !== undefined) set.title = parseTitle(i.title);
        if (i.searchText !== undefined) set.searchText = i.searchText;
        return mutate(i.id, i.expectedUpdatedAt, set, false);
      },
      setArchived(i) {
        return mutate(
          i.id,
          i.expectedUpdatedAt,
          { archivedAt: i.archived ? deps.now() : null },
          false,
        );
      },
      setDeleted(i) {
        // Restoring targets a deleted row, deleting targets a live one.
        return mutate(
          i.id,
          i.expectedUpdatedAt,
          { deletedAt: i.deleted ? deps.now() : null },
          !i.deleted,
        );
      },
      addLink: (i) => insertLink(tx, i, (id) => changed.add(id)),
      removeLink: (id) => deleteLink(tx, id, (itemId) => changed.add(itemId)),
    };
    return fn(writer);
  });
  deps.changes.publish(changed);
  return result;
}
