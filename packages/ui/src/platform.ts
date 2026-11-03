type NavigatorWithUAData = Navigator & {
  userAgentData?: { platform?: string };
};

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as NavigatorWithUAData;
  return nav.userAgentData?.platform || nav.platform || "";
}

export function isMac(platform: string = detectPlatform()): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function modKeyLabel(platform?: string): "⌘" | "Ctrl" {
  return isMac(platform) ? "⌘" : "Ctrl";
}

/** Input types that take no typing: keys pressed there are shortcuts. */
const NO_TYPING =
  /^(checkbox|radio|button|submit|reset|range|color|file|image)$/;

/**
 * Whether keys pressed on `target` are typing (a text field, a select, an
 * editable region) rather than single-key shortcuts. A checkbox, radio,
 * button or link is not.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NO_TYPING.test(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return !!target.closest('[contenteditable]:not([contenteditable="false"])');
}
