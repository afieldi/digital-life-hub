import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("Home shows the greeting panel over the scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("scene")).toBeAttached();
  await expect(page.getByTestId("greeting")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /^Good (morning|afternoon|evening)$/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("Settings scene override persists across reloads", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Night" }).click();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-variant",
    "night",
  );
  await page.reload();
  await expect(page.getByTestId("scene")).toHaveAttribute(
    "data-variant",
    "night",
  );
  await expect(page.getByRole("tab", { name: "Night" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("/dev/ui lists stories", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.locator("[data-story]").first()).toBeVisible();
  expect(await page.locator("[data-story]").count()).toBeGreaterThan(10);
});

test("g s opens Sample and mod+K shows its palette action", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("greeting")).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/sample$/);
  // Device presets may report a different OS than the host: ask the page.
  const mac = await page.evaluate(() =>
    /mac/i.test(
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform || navigator.platform,
    ),
  );
  await page.keyboard.press(mac ? "Meta+k" : "Control+k");
  const option = page.getByRole("option", { name: "Hello from Sample" });
  await expect(option).toBeVisible();
  await option.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Hello from Sample" }),
  ).toBeVisible();
});
