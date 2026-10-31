import type { Item, Link, LinkKind } from "@dlh/core";
import type { Tx } from "../trpc";

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
