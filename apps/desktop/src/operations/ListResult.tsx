import type { AiListedItem, ModuleRegistry } from "@dlh/core";
import { iconFor } from "../shell/icons";

/**
 * A read's `{ heading, items }` in the command bar's result slot: one row per
 * item, opening the item type's `href`, with the item's `note` under its title.
 * One finished since it was listed (`done`) is struck through.
 */
export function ListResult({
  list,
  itemTypes,
  onOpen,
}: {
  list: { heading: string; items: readonly AiListedItem[] };
  itemTypes: ModuleRegistry["itemTypes"];
  onOpen: (href: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold text-ink-tertiary">
        {list.heading}
      </h2>
      {list.items.length === 0 ? (
        <p className="py-3 text-sm text-ink-muted">Nothing here</p>
      ) : null}
      {list.items.map((item) => {
        const itemType = itemTypes.get(item.type);
        const Icon = iconFor(itemType?.glyph);
        return (
          <button
            key={item.id}
            type="button"
            disabled={!itemType}
            onClick={() => itemType && onOpen(itemType.href(item.id))}
            className="flex min-h-[52px] items-center gap-3 rounded-14 px-3 text-left hover:bg-white/12 focus-visible:bg-white/12 focus-visible:outline-hidden disabled:cursor-default disabled:text-ink-muted"
          >
            <span className="flex size-[30px] shrink-0 items-center justify-center">
              <Icon
                aria-hidden="true"
                size={18}
                style={{ color: itemType?.color }}
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={`truncate text-[15px] ${item.done ? "text-ink-tertiary line-through" : ""}`}
              >
                {item.title}
              </span>
              {typeof item.note === "string" || item.done ? (
                <span className="text-xs text-ink-tertiary">
                  {[item.done ? "Done" : null, item.note]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}
