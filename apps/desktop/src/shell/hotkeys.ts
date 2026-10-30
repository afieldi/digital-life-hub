import { isMac } from "@dlh/ui";

export type HotkeyOptions = {
  platform: string;
  onCommandBar: () => void;
  onGo: (key: string) => void;
};

/** How long after `g` the second key still counts as a "go to" chord. */
export const GO_CHORD_MS = 1000;

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function")
    return false;
  const el = target as HTMLElement;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return !!el.closest('[contenteditable]:not([contenteditable="false"])');
}

/**
 * Global shell shortcuts: mod+K (⌘ on macOS, Ctrl elsewhere) opens the
 * command bar from anywhere; `g` then a letter within 1 s calls `onGo(letter)`,
 * except while typing in a field.
 */
export function createHotkeys({
  platform,
  onCommandBar,
  onGo,
}: HotkeyOptions): (e: KeyboardEvent) => void {
  const mac = isMac(platform);
  let gAt: number | null = null;

  return (e) => {
    const key = e.key.toLowerCase();
    const mod = mac ? e.metaKey : e.ctrlKey;
    const otherMod = mac ? e.ctrlKey : e.metaKey;

    if (key === "k" && mod && !otherMod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      gAt = null;
      onCommandBar();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) {
      gAt = null;
      return;
    }

    const now = Date.now();
    if (gAt !== null && now - gAt <= GO_CHORD_MS && /^[a-z]$/.test(key)) {
      gAt = null;
      onGo(key);
      return;
    }
    gAt = key === "g" ? now : null;
  };
}
