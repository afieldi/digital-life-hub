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

test("board keyboard move", async ({ page }) => {
  await page.goto("/?story=patterns%2Fboard");
  const story = page.locator('[data-story="patterns/board"]');
  await story.waitFor();
  const todo = story.getByRole("grid", { name: "To do" });
  const inProgress = story.getByRole("grid", { name: "In progress" });
  const first = todo.getByRole("row").first();
  const title = "Migrate blog posts"; // first To do card (id t1) in the story
  await expect(first).toContainText(title);
  // RAC GridList starts keyboard drags from the card's drag button.
  await page.keyboard.press("Tab");
  await first.focus();
  await page.keyboard.press("ArrowRight"); // into the card: its drag button
  await expect(
    first.getByRole("button", { name: `Drag ${title}` }),
  ).toBeFocused();
  await page.keyboard.press("Enter"); // start keyboard drag
  // Tab moves between drop targets until one is inside "In progress".
  for (let i = 0; i < 8; i++) {
    const inTarget = await inProgress.evaluate((el) =>
      el.contains(document.activeElement),
    );
    if (inTarget) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter"); // drop
  await expect(inProgress.getByText(title, { exact: true })).toBeVisible();
  await expect(todo.getByText(title, { exact: true })).toHaveCount(0);
  // The first drop target Tab reaches in "In progress" appends the card:
  // index 2, after its two cards.
  await expect(story.locator("[data-last-move]")).toHaveAttribute(
    "data-last-move",
    JSON.stringify(["t1", "in_progress", 2]),
  );
  await expect(inProgress.getByRole("row").last()).toContainText(title);
});

test("dock labels are not text-selectable", async ({ page }) => {
  // A triple-click on the last paragraph above the dock selects through to the
  // next selectable text; if that is a dock label, WebKit paints the whole gap.
  await page.goto("/?story=dusk%2Fdock");
  const nav = page.locator('[data-story="dusk/dock"] nav');
  await nav.waitFor();
  const labels = await nav.locator("a").allInnerTexts();
  expect(labels.length).toBeGreaterThan(0);
  const selected = await page.evaluate(() => {
    const sel = window.getSelection();
    sel?.selectAllChildren(document.body);
    return sel?.toString() ?? "";
  });
  for (const label of labels) expect(selected).not.toContain(label.trim());
});
