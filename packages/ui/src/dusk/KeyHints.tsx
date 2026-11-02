import { Kbd } from "./Kbd";

export type KeyHint = { keys: string[]; label: string };

/** A row of shortcut reminders: each key cap followed by what it does. */
export function KeyHints({
  hints,
  platform,
}: {
  hints: KeyHint[];
  /** Override platform detection (tests, stories). */
  platform?: string;
}) {
  return (
    <ul
      aria-label="Keyboard shortcuts"
      className="flex flex-wrap gap-3 px-2 font-ui text-xs text-ink-tertiary"
    >
      {hints.map((h) => (
        <li key={h.label} className="flex items-center gap-1.5">
          <Kbd keys={h.keys} platform={platform} />
          {h.label}
        </li>
      ))}
    </ul>
  );
}
