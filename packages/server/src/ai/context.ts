import type { Item } from "@dlh/core";
import { getItem, getItemText, linksForItem } from "../items/read";
import type { CoreDeps } from "../trpc";

export type AiContext = {
  item: Item | null;
  text: string;
  version: string | null;
};

/** Upper bound on the characters of item context handed to a model. */
export const MAX_CONTEXT_CHARS = 12_000;

const ELLIPSIS = "…";

type Block = {
  header: string;
  body: string;
  links: string[];
  backlinks: string[];
};

function render({ header, body, links, backlinks }: Block): string {
  const parts = [header];
  if (body) parts.push("", "Body:", body);
  if (links.length) parts.push("", "Links:", ...links);
  if (backlinks.length) parts.push("Backlinks:", ...backlinks);
  return parts.join("\n");
}

/**
 * Fit the block into MAX_CONTEXT_CHARS: shorten the body first, then drop link
 * lines from the end (backlinks before outgoing links). The title, type and id
 * lines are never cut, and each link line keeps its id.
 */
function fit(block: Block): string {
  let text = render(block);
  if (text.length <= MAX_CONTEXT_CHARS) return text;

  if (block.body) {
    const withoutBody = render({ ...block, body: "" }).length;
    const overhead = render({ ...block, body: "a" }).length - withoutBody - 1;
    const budget = MAX_CONTEXT_CHARS - withoutBody - overhead - ELLIPSIS.length;
    block = {
      ...block,
      body: budget > 0 ? block.body.slice(0, budget) + ELLIPSIS : "",
    };
    text = render(block);
  }
  while (
    text.length > MAX_CONTEXT_CHARS &&
    (block.links.length || block.backlinks.length)
  ) {
    block = block.backlinks.length
      ? { ...block, backlinks: block.backlinks.slice(0, -1) }
      : { ...block, links: block.links.slice(0, -1) };
    text = render(block);
  }
  return text;
}

/**
 * Plain-text description of an item and its links, with their ids (so an
 * answer can name the items it used), for use as model context.
 */
export async function itemContext(
  deps: CoreDeps,
  itemId: string | null,
): Promise<AiContext> {
  if (itemId === null) return { item: null, text: "", version: null };
  const item = await getItem(deps.db, itemId);
  const [body, { outgoing, backlinks }] = await Promise.all([
    getItemText(deps.db, itemId),
    linksForItem(deps.db, itemId),
  ]);
  const line = (l: { kind: string; item: { id: string; title: string } }) =>
    `- ${l.kind}: ${l.item.title} (id ${l.item.id})`;
  const text = fit({
    header: `Title: ${item.title}\nType: ${item.type}\nId: ${item.id}`,
    body: body ?? "",
    links: outgoing.map(line),
    backlinks: backlinks.map(line),
  });
  return { item, text, version: item.updatedAt };
}
