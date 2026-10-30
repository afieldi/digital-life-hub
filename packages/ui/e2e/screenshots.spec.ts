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
  const reset = async () => {
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.mouse.move(0, 0);
  };
  for (const id of ids) {
    const story = page.locator(`[data-story="${id}"]`);
    // Stories mark one element per forced state; each state is applied for real
    // (keyboard focus, pointer hover, pointer down) and undone before the next
    // story so states never leak between screenshots.
    const focus = story.locator(`[data-force-focus] ${interactive}`).first();
    const hover = story.locator(`[data-force-hover] ${interactive}`).first();
    const press = story.locator(`[data-force-press] ${interactive}`).first();
    await reset();
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
    await reset();
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
