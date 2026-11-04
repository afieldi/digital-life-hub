import { iconFor } from "../icons";

/**
 * A coloured square with an item type's icon. `glyph` is a Lucide icon name and
 * `color` a CSS colour, as a module's `itemType` gives them.
 */
export function TypeTile({
  glyph,
  color,
  size = 34,
}: {
  glyph: string;
  color: string;
  size?: 30 | 34 | 36;
}) {
  const Icon = iconFor(glyph);
  return (
    <span
      data-testid="type-tile"
      data-glyph={glyph}
      style={{ backgroundColor: color, width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-10 text-app"
    >
      <Icon
        aria-hidden="true"
        size={Math.round(size * 0.5)}
        strokeWidth={2.25}
      />
    </span>
  );
}
