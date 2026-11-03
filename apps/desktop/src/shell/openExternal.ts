import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens a web link outside the app. The desktop webview ignores
 * `window.open`, so there the opener plugin hands it to the system, within
 * the URLs `capabilities/default.json` allows (https only); the browser opens
 * a new window. Anything else (`javascript:`, `file:`, a non-URL, and `http:`
 * in the desktop app) is refused with an error before it reaches either.
 */
export async function openExternal(url: string): Promise<void> {
  const protocol = protocolOf(url);
  const allowed = isTauri() ? ["https:"] : ["https:", "http:"];
  if (!protocol || !allowed.includes(protocol)) {
    throw new Error(`Not a link this app opens: ${url}`);
  }
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}
