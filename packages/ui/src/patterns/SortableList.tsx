import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropIndicator,
  GridList,
  GridListItem,
  type Key,
  Button as RACButton,
  useDragAndDrop,
} from "react-aria-components";
import { focusRing } from "../primitives/focus";
import { indexFor } from "./boardMath";

export type SortableListProps<T extends { id: string }> = {
  /** Accessible name of the list. */
  label: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
  /** Fired for pointer and keyboard drops. `index` is the item's new position
   * once it has been taken out of where it was. */
  onMove: (itemId: string, index: number) => void;
  /** Accessible text for a row (typeahead, drag announcements). */
  textValue: (item: T) => string;
};

/**
 * Rows you put in order by dragging, each with a drag handle (Enter starts a
 * keyboard drag). Rows may hold their own controls, like a checkbox or a link.
 */
export function SortableList<T extends { id: string }>({
  label,
  items,
  renderItem,
  onMove,
  textValue,
}: SortableListProps<T>) {
  const ids = items.map((i) => i.id);
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys: Set<Key>) =>
      [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder: (e) => {
      const moving = [...e.keys].map(String);
      let index = indexFor(ids, moving, e.target);
      for (const id of moving) onMove(id, index++);
    },
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className="h-0.5 rounded-full bg-transparent drop-target:bg-link"
      />
    ),
  });
  return (
    <GridList
      aria-label={label}
      items={items}
      dragAndDropHooks={dragAndDropHooks}
      className="flex flex-col gap-0.5 font-ui outline-hidden"
    >
      {(item) => (
        <GridListItem
          id={item.id}
          textValue={textValue(item)}
          className={`flex min-h-11 items-center gap-1 rounded-14 pr-1 pl-3 text-ink-primary hover:bg-white/6 dragging:opacity-50 ${focusRing}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {renderItem(item)}
          </div>
          <RACButton
            slot="drag"
            className={`flex size-11 shrink-0 cursor-grab items-center justify-center rounded-10 text-ink-tertiary opacity-60 hovered:opacity-100 focus-visible:opacity-100 ${focusRing}`}
          >
            <GripVertical aria-hidden="true" size={16} />
          </RACButton>
        </GridListItem>
      )}
    </GridList>
  );
}
