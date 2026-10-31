import type { Page } from "@playwright/test";

/** Opens the command bar. Device presets may report a different OS than the host: ask the page. */
export async function openPalette(page: Page): Promise<void> {
  const mac = await page.evaluate(() =>
    /mac/i.test(
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform || navigator.platform,
    ),
  );
  await page.keyboard.press(mac ? "Meta+k" : "Control+k");
}
