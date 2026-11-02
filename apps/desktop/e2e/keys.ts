import type { Page } from "@playwright/test";

/**
 * Presses Mod+↵ with the modifier the app uses. The app picks ⌘ or Ctrl from
 * the browser's reported platform, which can differ from the host OS that
 * Playwright's ControlOrMeta follows (headless Chromium on macOS reports
 * a non-Mac platform).
 */
export async function modEnter(page: Page): Promise<void> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    return /mac|iphone|ipad|ipod/i.test(
      nav.userAgentData?.platform || nav.platform || "",
    );
  });
  await page.keyboard.press(mac ? "Meta+Enter" : "Control+Enter");
}
