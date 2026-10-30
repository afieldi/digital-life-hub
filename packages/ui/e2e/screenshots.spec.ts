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
    // Stories mark one element with data-force-focus; focus it via the keyboard.
    const target = page
      .locator(`[data-story="${id}"] [data-force-focus] :is(button, input)`)
      .first();
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    if (await target.count()) {
      await page.keyboard.press("Tab");
      await target.focus();
    }
    await expect(page.locator(`[data-story="${id}"]`)).toHaveScreenshot(
      `${id.replaceAll("/", "-")}.png`,
    );
  }
});

test("keyboard focus draws a visible ring", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-story]");
  const button = page
    .locator('[data-story="primitives/button-glass"] button')
    .first();
  await page.keyboard.press("Tab");
  await button.focus();
  const style = await button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth };
  });
  expect(style.style).not.toBe("none");
  expect(style.width).not.toBe("0px");
});
