import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens a web link outside the app. The desktop webview ignores
 * `window.open`, so there the opener plugin hands it to the system, within
 * the URLs `capabilities/default.json` allows; the browser opens a new window.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
