import { GripVertical, Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import {
  DropIndicator,
  type DropItem,
  type DropTarget,
  GridList,
  GridListItem,
  isTextDropItem,
  type Key,
  Button as RACButton,
  useDragAndDrop,
} from "react-aria-components";
import { Button } from "../primitives/Button";
import { focusRing } from "../primitives/focus";
import { indexFor } from "./boardMath";

export type BoardColumnDef = { id: string; title: string; dot: string };

export type BoardProps<T extends { id: string }> = {
  columns: BoardColumnDef[];
  items: T[];
  columnOf: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  /** Fired for mouse, touch and keyboard drops. `index` is the card's position
   * in `toColumn` once it has been removed from where it was. */
  onMove: (itemId: string, toColumn: string, index: number) => void;
  onAdd?: (columnId: string) => void;
  /** Accessible text for a card (typeahead, drag announcements). Defaults to its id. */
  textValue?: (item: T) => string;
};

// Custom type so cards only drop on boards, never into other drop zones.
const CARD_TYPE = "application/x-dlh-board-card";

export function Board<T extends { id: string }>({
  columns,
  items,
  columnOf,
  renderCard,
  onMove,
  onAdd,
  textValue,
}: BoardProps<T>) {
  return (
    <div className="flex items-start gap-4 font-ui">
      {columns.map((col) => (
        <BoardColumn
          key={col.id}
          column={col}
          items={items.filter((i) => columnOf(i) === col.id)}
          renderCard={renderCard}
          onMove={onMove}
          onAdd={onAdd}
          textValue={textValue}
        />
      ))}
    </div>
  );
}

async function draggedIds(items: DropItem[]): Promise<string[]> {
  return Promise.all(
    items.filter(isTextDropItem).map((item) => item.getText(CARD_TYPE)),
  );
}

function BoardColumn<T extends { id: string }>({
  column,
  items,
  renderCard,
  onMove,
  onAdd,
  textValue,
}: {
  column: BoardColumnDef;
  items: T[];
  renderCard: (item: T) => ReactNode;
  onMove: BoardProps<T>["onMove"];
  onAdd?: (columnId: string) => void;
  textValue?: (item: T) => string;
}) {
  const headingId = useId();
  const ids = items.map((i) => i.id);
  const moveAll = (moving: string[], target: DropTarget) => {
    let index = indexFor(ids, moving, target);
    for (const id of moving) onMove(id, column.id, index++);
  };

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys: Set<Key>) =>
      [...keys].map((key) => ({ [CARD_TYPE]: String(key) })),
    acceptedDragTypes: [CARD_TYPE],
    getDropOperation: () => "move",
    onReorder: (e) => moveAll([...e.keys].map(String), e.target),
    onInsert: async (e) => moveAll(await draggedIds(e.items), e.target),
    onRootDrop: async (e) =>
      moveAll(await draggedIds(e.items), { type: "root" }),
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className="h-0.5 rounded-full bg-transparent drop-target:bg-link"
      />
    ),
  });

  return (
    <section
      aria-labelledby={headingId}
      className="glass-panel flex w-[260px] shrink-0 flex-col gap-2.5 p-3.5 text-ink-primary"
    >
      <h2
        id={headingId}
        className="flex min-h-8 items-center gap-2 px-1 text-[15px] font-semibold"
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: column.dot }}
          className="size-2.5 shrink-0 rounded-full"
        />
        <span>{column.title}</span>
        <span className="font-normal text-ink-tertiary">{items.length}</span>
      </h2>
      <GridList
        aria-label={column.title}
        items={items}
        dragAndDropHooks={dragAndDropHooks}
        renderEmptyState={() => (
          <div className="min-h-16 rounded-14 border border-dashed border-white/20" />
        )}
        className="flex min-h-16 flex-col gap-2.5 rounded-14 outline-hidden drop-target:bg-white/6"
      >
        {(item) => (
          <GridListItem
            id={item.id}
            textValue={textValue ? textValue(item) : item.id}
            className={`glass-raised relative cursor-grab p-3.5 pr-11 text-ink-primary dragging:opacity-50 ${focusRing}`}
          >
            <div className="flex flex-col gap-2.5">{renderCard(item)}</div>
            {/* RAC GridList starts keyboard drags from a drag button (Enter);
                pointer drags work from anywhere on the card. */}
            <RACButton
              slot="drag"
              className={`absolute top-1 right-1 flex size-11 cursor-grab items-center justify-center rounded-10 text-ink-tertiary opacity-60 hovered:opacity-100 focus-visible:opacity-100 ${focusRing}`}
            >
              <GripVertical aria-hidden="true" size={16} />
            </RACButton>
          </GridListItem>
        )}
      </GridList>
      {onAdd ? (
        <Button
          variant="dashed"
          onPress={() => onAdd(column.id)}
          className="w-full"
        >
          <Plus aria-hidden="true" size={16} />
          Add card
        </Button>
      ) : null}
    </section>
  );
}
