import { isMac, isTextEntry } from "@dlh/ui";

export type HotkeyOptions = {
  platform: string;
  onCommandBar: () => void;
  onGo: (key: string) => void;
};

/** How long after `g` the second key still counts as a "go to" chord. */
export const GO_CHORD_MS = 1000;

export type Hotkeys = {
  /** The window's keydown listener. */
  onKeyDown: (e: KeyboardEvent) => void;
  /**
   * Whether a `g` started a "go to" chord that the next letter completes. A
   * screen's own key handler runs before the window's listener, so it can ask
   * this about the key it is handling and leave that key to the shell.
   */
  goPending: () => boolean;
};

/**
 * Global shell shortcuts: mod+K (⌘ on macOS, Ctrl elsewhere) opens the
 * command bar from anywhere; `g` then a letter within 1 s calls `onGo(letter)`,
 * except while typing in a field.
 */
export function createHotkeys({
  platform,
  onCommandBar,
  onGo,
}: HotkeyOptions): Hotkeys {
  const mac = isMac(platform);
  let gAt: number | null = null;
  const goPending = () => gAt !== null && Date.now() - gAt <= GO_CHORD_MS;

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const mod = mac ? e.metaKey : e.ctrlKey;
    const otherMod = mac ? e.ctrlKey : e.metaKey;

    if (key === "k" && mod && !otherMod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      gAt = null;
      onCommandBar();
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) {
      gAt = null;
      return;
    }

    if (goPending() && /^[a-z]$/.test(key)) {
      gAt = null;
      onGo(key);
      return;
    }
    gAt = key === "g" ? Date.now() : null;
  };
  return { onKeyDown, goPending };
}
