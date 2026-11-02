export type DayBar = { label: string; value: number };

/**
 * A small bar per day, like completions this week. Read as one image: its
 * label lists every day's value. `highlight` marks one bar (e.g. today).
 */
export function DayBars({
  label,
  bars,
  highlight,
}: {
  label: string;
  bars: DayBar[];
  highlight?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div
      role="img"
      aria-label={`${label}: ${bars.map((b) => `${b.label} ${b.value}`).join(", ")}`}
      className="flex h-[120px] items-end gap-2 font-ui"
    >
      {bars.map((b, i) => (
        <div
          key={b.label}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
        >
          <div
            className={`w-full max-w-7 rounded-t-[6px] ${
              i === highlight ? "bg-type-task" : "bg-type-task/45"
            }`}
            style={{ height: `${Math.max(4, (b.value / max) * 92)}px` }}
          />
          <span className="text-xs text-ink-tertiary">
            {b.label.slice(0, 1)}
          </span>
        </div>
      ))}
    </div>
  );
}
