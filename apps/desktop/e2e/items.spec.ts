import type { AppRouter } from "@dlh/api/router";
import { expect, type Page, test } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { signIn } from "./signIn";

const API_URL = "http://127.0.0.1:8787";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

/** Device presets may report a different OS than the host: ask the page. */
async function openPalette(page: Page): Promise<void> {
  const mac = await page.evaluate(() =>
    /mac/i.test(
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData?.platform || navigator.platform,
    ),
  );
  await page.keyboard.press(mac ? "Meta+k" : "Control+k");
}

test("create, find, recent and live rename of a sample item", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/sample");

  await page.getByLabel("New sample item").fill("E2E item");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("E2E item").first()).toBeVisible();

  // Search finds it and opens its page.
  await openPalette(page);
  await page.getByRole("combobox").fill("e2e");
  await page.getByRole("option", { name: /E2E item/ }).click();
  await expect(page).toHaveURL(/\/sample\/[^/]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E item" }),
  ).toBeAttached();
  const itemUrl = page.url();

  // Opening it recorded a view: it is now under Recents on an empty query.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page.getByTestId("greeting")).toBeVisible();
  await openPalette(page);
  await expect(page.getByRole("option", { name: /E2E item/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // A rename made elsewhere reaches the open page through /changes.
  await page.goto(itemUrl);
  const id = new URL(itemUrl).pathname.split("/").pop() as string;
  const token = await page.evaluate(() =>
    localStorage.getItem("dlh.devSessionToken"),
  );
  expect(token).toBeTruthy();
  const api = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${API_URL}/trpc`,
        headers: { Authorization: `Bearer ${token}` },
      }),
    ],
  });
  const current = await api.items.get.query({ id });
  await api.items.rename.mutate({
    id,
    expectedUpdatedAt: current.updatedAt,
    title: "E2E item renamed",
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E item renamed" }),
  ).toBeVisible({ timeout: 2000 });
});
