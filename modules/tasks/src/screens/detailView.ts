import type { ItemSummary, Link } from "@dlh/core";
import { type Day, formatWhen } from "../dates";

/** "Created Oct 28 · edited Today 14:05", 24-hour in `tz`. */
export function editedLine(
  createdAt: string,
  updatedAt: string,
  tz: string,
  today: Day,
): string {
  const created = formatWhen({ dateTime: createdAt }, tz, today).text;
  const edited = formatWhen({ dateTime: updatedAt }, tz, today).text;
  // A creation day reads alone; only the edit carries its time.
  return `Created ${created.replace(/ \d+:\d+$/, "")} · edited ${edited}`;
}

type LinkWithItem = Link & { item: ItemSummary };

export type LinkedRow = {
  link: LinkWithItem;
  item: ItemSummary;
  direction: "outgoing" | "backlink";
};

/**
 * What the Linked section lists: every link but those between this task and
 * its task parents or subtasks, which have sections of their own.
 */
export function linkedRows(links: {
  outgoing: LinkWithItem[];
  backlinks: LinkWithItem[];
}): LinkedRow[] {
  const shown = (l: LinkWithItem) =>
    !(l.kind === "contains" && l.item.type === "task");
  return [
    ...links.outgoing.filter(shown).map((link) => ({
      link,
      item: link.item,
      direction: "outgoing" as const,
    })),
    ...links.backlinks.filter(shown).map((link) => ({
      link,
      item: link.item,
      direction: "backlink" as const,
    })),
  ];
}
