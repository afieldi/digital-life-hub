import { expect, test } from "@playwright/test";

test("every registered story matches its screenshot", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-story]");
  await page.evaluate(() => document.fonts.ready);
  const ids = await page
    .locator("[data-story]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-story") ?? ""));
  expect(ids.length).toBeGreaterThan(0);
  const interactive = ":is(button, input, [role=tab])";
  for (const id of ids) {
    // Each story loads alone at a fixed position over the Scene, so screenshots
    // never depend on page layout or on state left by another story. Stories mark
    // one element per forced state; it is applied for real (keyboard focus,
    // pointer hover, pointer down).
    await page.goto(`/?story=${encodeURIComponent(id)}`);
    const story = page.locator(`[data-story="${id}"]`);
    await story.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const focus = story.locator(`[data-force-focus] ${interactive}`).first();
    const hover = story.locator(`[data-force-hover] ${interactive}`).first();
    const press = story.locator(`[data-force-press] ${interactive}`).first();
    if (await focus.count()) {
      await page.keyboard.press("Tab");
      await focus.focus();
    }
    if (await hover.count()) await hover.hover();
    const pressing = (await press.count()) > 0;
    if (pressing) {
      await press.hover();
      await page.mouse.down();
    }
    await expect(story).toHaveScreenshot(`${id.replaceAll("/", "-")}.png`);
    if (pressing) await page.mouse.up();
  }
});

test("keyboard focus draws a visible ring", async ({ page }) => {
  await page.goto("/?story=primitives%2Fbutton-glass");
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
