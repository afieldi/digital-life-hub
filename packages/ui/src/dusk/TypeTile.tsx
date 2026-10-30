import {
  Check,
  Clock,
  LayoutGrid,
  type LucideIcon,
  Pilcrow,
  Sparkles,
} from "lucide-react";
import { type ItemType, typeColors } from "../tokens";

const icons: Record<ItemType, LucideIcon> = {
  task: Check,
  note: Pilcrow,
  project: LayoutGrid,
  event: Clock,
  ai: Sparkles,
};

export function TypeTile({
  type,
  size = 34,
}: {
  type: ItemType;
  size?: 30 | 34 | 36;
}) {
  const Icon = icons[type];
  return (
    <span
      data-testid="type-tile"
      data-type={type}
      style={{ backgroundColor: typeColors[type], width: size, height: size }}
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
