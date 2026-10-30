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
