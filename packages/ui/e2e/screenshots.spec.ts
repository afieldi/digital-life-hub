import { chromium, expect, test } from "@playwright/test";

const baseURL = `http://localhost:${process.env.GALLERY_PORT ?? 6006}`;

// One test per story, generated at collection time from the gallery's own
// registry (read from the running gallery), so one mismatch never hides the
// rest and a single story can be targeted: `-g "dusk/dock-focus"`.
async function listStoryIds(): Promise<string[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/`);
    await page.waitForSelector("[data-story]");
    return await page
      .locator("[data-story]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-story") ?? ""),
      );
  } finally {
    await browser.close();
  }
}

const ids = await listStoryIds();
const interactive = ":is(button, input, a, [role=tab], [role=spinbutton])";

test("gallery registers stories", () => {
  expect(ids.length).toBeGreaterThan(0);
});

for (const id of ids) {
  test(`story ${id} matches its screenshot`, async ({ page }) => {
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
  });
}

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
