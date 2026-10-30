import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import {
  ModalOverlay,
  Dialog as RACDialog,
  Modal as RACModal,
} from "react-aria-components";
import { Kbd } from "../dusk/Kbd";
import { modalBackdropClass } from "../internal/classes";

export type CommandItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  onAction: () => void;
};

export type CommandGroup = {
  id: "create" | "actions" | "ai" | "jump";
  label: string;
  items: CommandItem[];
};

export type CommandBarProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Already filtered by the caller; shown create → actions → ai → jump. */
  groups: CommandGroup[];
  placeholder?: string;
  /** Replaces the default ↵ / ↑↓ / esc hints. */
  footer?: ReactNode;
  /**
   * Backdrop covers its portal container instead of the viewport.
   * @internal gallery only
   */
  contained?: boolean;
};

const ORDER: CommandGroup["id"][] = ["create", "actions", "ai", "jump"];

function DefaultFooter() {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <Kbd keys={["↵"]} /> to select
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd keys={["↑↓"]} /> to navigate
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd keys={["esc"]} /> to close
      </span>
    </>
  );
}

export function CommandBar({
  isOpen,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  placeholder = "Search, create, or ask AI",
  footer,
  contained,
}: CommandBarProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (id: string) => `${baseId}-opt-${id}`;

  const visible = ORDER.map((id) => groups.find((g) => g.id === id)).filter(
    (g): g is CommandGroup => !!g && g.items.length > 0,
  );
  const flat = visible.flatMap((g) => g.items);

  // The highlight returns to the first row whenever the query changes.
  const [active, setActive] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change only
  useEffect(() => setActive(0), [query]);
  const activeIndex = Math.min(active, Math.max(flat.length - 1, 0));
  const activeItem = flat[activeIndex];
  const activeId = activeItem ? optionId(activeItem.id) : undefined;

  // The list scrolls (panel is height-capped): keep the highlighted row visible.
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const run = (item: CommandItem) => {
    item.onAction();
    onOpenChange(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter" && activeItem) {
      e.preventDefault();
      run(activeItem);
    }
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={`${contained ? "absolute" : "fixed"} ${modalBackdropClass} items-start!`}
    >
      <RACModal className="glass-dialog mt-[110px] flex max-h-[calc(100%-140px)] w-[min(680px,calc(100%-32px))] flex-col overflow-hidden rounded-[22px] outline-hidden">
        <RACDialog
          aria-label="Command bar"
          className="flex min-h-0 flex-1 flex-col font-ui text-ink-primary outline-hidden"
        >
          <div className="flex min-h-[60px] items-center gap-3 border-b border-white/12 px-5">
            <Search
              aria-hidden="true"
              size={20}
              className="shrink-0 text-ink-tertiary"
            />
            <input
              // biome-ignore lint/a11y/noAutofocus: the command bar exists to be typed into
              autoFocus
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              aria-label={placeholder}
              placeholder={placeholder}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="min-h-11 flex-1 bg-transparent text-[19px] text-ink-primary outline-hidden placeholder:text-ink-muted"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Results"
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
          >
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-tertiary">
                {query
                  ? `No results for “${query}”`
                  : "Start typing to search, create, or ask AI"}
              </p>
            ) : null}
            {visible.map((group) => (
              // A listbox may only own option/group children; fieldset is not allowed.
              // biome-ignore lint/a11y/useSemanticElements: ARIA listbox group
              <div
                key={group.id}
                role="group"
                aria-labelledby={`${baseId}-group-${group.id}`}
              >
                <div
                  id={`${baseId}-group-${group.id}`}
                  className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-tertiary"
                >
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  const selected = index === activeIndex;
                  return (
                    // Focus stays in the input (aria-activedescendant); rows are
                    // reached with ↑↓, so they need no key handler of their own.
                    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
                    <div
                      key={item.id}
                      id={optionId(item.id)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      onMouseMove={() => setActive(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(item)}
                      className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-14 px-3 ${selected ? "bg-white/12" : ""}`}
                    >
                      {item.icon ? (
                        <span className="flex size-[30px] shrink-0 items-center justify-center">
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="flex-1 truncate text-[15px]">
                        {item.label}
                      </span>
                      {item.hint ? (
                        <span className="text-xs text-ink-tertiary">
                          {item.hint}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex min-h-11 items-center gap-5 border-t border-white/12 px-5 text-xs text-ink-tertiary">
            {footer ?? <DefaultFooter />}
          </div>
        </RACDialog>
      </RACModal>
    </ModalOverlay>
  );
}
