import { expect, test } from "@playwright/test";

test("every registered story matches its screenshot", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-story]");
  await page.evaluate(() => document.fonts.ready);
  const ids = await page
    .locator("[data-story]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-story") ?? ""));
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    await expect(page.locator(`[data-story="${id}"]`)).toHaveScreenshot(
      `${id.replaceAll("/", "-")}.png`,
    );
  }
});
