import type { DropTarget } from "react-aria-components";

/**
 * Index in `ids` (a column's card ids, in order) at which cards dropped on
 * `target` land, counted once the `moving` cards are removed from the column.
 * Same-column reorders pass the column's own ids; cross-column inserts pass the
 * target column's ids (which don't contain the moving cards).
 */
export function indexFor(
  ids: string[],
  moving: string[],
  target: DropTarget,
): number {
  const rest = ids.filter((id) => !moving.includes(id));
  if (target.type !== "item") return rest.length;
  const at = rest.indexOf(String(target.key));
  if (at === -1) return rest.length;
  return target.dropPosition === "after" ? at + 1 : at;
}
