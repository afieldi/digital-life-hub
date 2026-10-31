import type { ItemSummary, ModuleRegistry } from "@dlh/core";
import type { CommandGroup, CommandItem } from "@dlh/ui";
import { House, type LucideIcon, Settings as SettingsIcon } from "lucide-react";
import { createElement } from "react";
import { iconFor } from "./icons";

/** Case-insensitive substring match over the label and keywords; an empty query matches. */
export function matchesQuery(
  label: string,
  keywords: string[] | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [label, ...(keywords ?? [])].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/** Palette rows for items: the type's glyph and colour, navigating to its `href`. */
export function itemRows(
  items: ItemSummary[],
  itemTypes: ModuleRegistry["itemTypes"],
  navigate: (to: string) => void,
): CommandItem[] {
  return items.map((item) => {
    const itemType = itemTypes.get(item.type);
    if (!itemType) {
      return {
        id: item.id,
        label: item.title,
        disabled: true,
        hint: "no module for this type",
        onAction: () => {},
      };
    }
    return {
      id: item.id,
      label: item.title,
      icon: createElement(iconFor(itemType.glyph), {
        "aria-hidden": true,
        size: 18,
        style: { color: itemType.color },
      }),
      onAction: () => navigate(itemType.href(item.id)),
    };
  });
}

/** Home (`G H`), each module nav entry (`G <KEY>` when it has a key), then Settings. */
export function goToRows(
  nav: ModuleRegistry["nav"],
  navigate: (to: string) => void,
): CommandItem[] {
  const icon = (Icon: LucideIcon) =>
    createElement(Icon, { "aria-hidden": true, size: 18 });
  return [
    {
      id: "goto:home",
      label: "Home",
      icon: icon(House),
      hint: "G H",
      onAction: () => navigate("/"),
    },
    ...nav.map((n) => ({
      id: `goto:${n.path}`,
      label: n.label,
      icon: icon(iconFor(n.icon)),
      hint: n.key ? `G ${n.key.toUpperCase()}` : undefined,
      onAction: () => navigate(n.path),
    })),
    {
      id: "goto:settings",
      label: "Settings",
      icon: icon(SettingsIcon),
      onAction: () => navigate("/settings"),
    },
  ];
}

/** The Jump to group for a search state; `null` while no search is wanted. */
export function jumpGroup(state: {
  status: "idle" | "loading" | "error" | "ok";
  items: CommandItem[];
}): CommandGroup | null {
  if (state.status === "idle") return null;
  const group: CommandGroup = { id: "jump", label: "Jump to", items: [] };
  if (state.status === "error") group.message = "Search unavailable";
  else if (state.status === "ok") {
    if (state.items.length === 0) group.message = "No items match";
    else group.items = state.items;
  }
  return group;
}
