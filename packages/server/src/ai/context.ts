import type { Item } from "@dlh/core";

export type AiContext = {
  item: Item | null;
  text: string;
  version: string | null;
};
