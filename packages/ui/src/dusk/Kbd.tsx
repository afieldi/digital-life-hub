import { isMac, modKeyLabel } from "../platform";

/** Keyboard shortcut label. "mod" becomes ⌘ on macOS and Ctrl elsewhere. */
export function Kbd({
  keys,
  platform,
  className,
}: {
  keys: string[];
  /** Override platform detection (tests, stories). */
  platform?: string;
  className?: string;
}) {
  const parts = keys.map((k) => (k === "mod" ? modKeyLabel(platform) : k));
  const text = parts.join(isMac(platform) ? "" : " ");
  return (
    <kbd
      className={`rounded-10 bg-white/8 px-1.5 py-0.5 font-ui text-xs text-ink-tertiary${className ? ` ${className}` : ""}`}
    >
      {text}
    </kbd>
  );
}
