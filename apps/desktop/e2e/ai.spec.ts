import { expect, type Page, test } from "@playwright/test";
import { openPalette } from "./palette";
import { signIn } from "./signIn";

// The API runs with AI_FAKE_PROVIDER=1: a scripted OpenRouter answers every
// action with canned output, and text containing [bad] with non-JSON.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

/** Signs in, creates a sample item (unique per run) and opens its page. */
async function openNewItem(page: Page, label: string): Promise<string> {
  const title = `AI item ${label} ${Date.now()}`;
  await signIn(page);
  await page.goto("/sample");
  await page.getByRole("textbox", { name: "New sample item" }).fill(title);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  return title;
}

/**
 * Types into the command bar and waits for the Understood as row. Callers run
 * the request with Mod+↵, which asks AI whether or not search rows are listed:
 * both browser projects share one database, so the other project's items can
 * show up as results. Plain ↵ is covered by the desktop db tests.
 */
async function ask(page: Page, text: string, action: string): Promise<void> {
  await openPalette(page);
  await page.getByRole("combobox").fill(text);
  await expect(page.getByText("Understood as")).toBeVisible();
  await expect(page.getByText(action, { exact: true })).toBeVisible();
  await expect(page.getByText("to ask AI")).toBeVisible();
}

/**
 * Presses Mod+↵ with the modifier the app uses. The app picks ⌘ or Ctrl from
 * the browser's reported platform, which can differ from the host OS that
 * Playwright's ControlOrMeta follows (headless Chromium on macOS reports
 * a non-Mac platform).
 */
async function modEnter(page: Page): Promise<void> {
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

test("Do renames the item and Undo restores the title", async ({
  page,
}, testInfo) => {
  const title = await openNewItem(page, testInfo.project.name);
  const heading = (name: string) =>
    page.getByRole("heading", { level: 1, name });

  await ask(page, "rename this", "Rename");
  await page.getByRole("radio", { name: "Do" }).click();
  await modEnter(page);

  await expect(page.getByText("Renamed to “Fake new title”")).toBeVisible();
  await expect(heading("Fake new title")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(heading(title)).toBeVisible();
});

test("Suggest shows options and Use applies the picked one", async ({
  page,
}, testInfo) => {
  await openNewItem(page, testInfo.project.name);

  await ask(page, "suggest a better title", "Rename");
  await page.getByRole("radio", { name: "Suggest" }).click();
  await modEnter(page);

  await expect(page.getByText("Fake title One")).toBeVisible();
  await expect(page.getByText("Reason Two.")).toBeVisible();
  await page.getByRole("button", { name: "Use Fake title Two" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Fake title Two" }),
  ).toBeVisible();
});

test("delete is shown first and cancelling leaves the item", async ({
  page,
}, testInfo) => {
  const title = await openNewItem(page, testInfo.project.name);

  await ask(page, "delete this", "Delete");
  await expect(page.getByText("Deletes always show you first")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Suggest" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await modEnter(page);

  await expect(page.getByText("Deletes this item.")).toBeVisible();
  await page.getByRole("button", { name: "None of these" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await page.goto("/sample");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("a bad model answer shows the message and changes nothing", async ({
  page,
}, testInfo) => {
  const title = await openNewItem(page, testInfo.project.name);

  await ask(page, "rename this [bad]", "Rename");
  await page.getByRole("radio", { name: "Do" }).click();
  await modEnter(page);

  await expect(
    page.getByText(
      "OpenRouter's answer wasn't in the expected format, so nothing was changed.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
});
