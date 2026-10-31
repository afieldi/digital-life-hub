import type { AppRouter } from "@dlh/api/router";
import { expect, test } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { openPalette } from "./palette";
import { signIn } from "./signIn";

const API_URL = "http://127.0.0.1:8787";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("create, find, recent and live rename of a sample item", async ({
  page,
}, testInfo) => {
  // The database is shared by both browser projects and never wiped between
  // them, so every title is unique to this run.
  const stamp = `${testInfo.project.name} ${Date.now()}`;
  const title = `E2E item ${stamp}`;
  const renamed = `E2E renamed ${stamp}`;

  await signIn(page);
  await page.goto("/sample");

  await page.getByRole("textbox", { name: "New sample item" }).fill(title);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // Search finds it and opens its page.
  await openPalette(page);
  await page.getByRole("combobox").fill(stamp);
  await page.getByRole("option", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/sample\/[^/]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  const itemUrl = page.url();

  // Opening it recorded a view: it is now under Recents on an empty query.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page.getByTestId("greeting")).toBeVisible();
  await openPalette(page);
  await expect(
    page.getByRole("option", { name: title, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // A rename made elsewhere reaches the open page through /changes.
  await page.goto(itemUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  const id = new URL(itemUrl).pathname.split("/").pop();
  if (!id) throw new Error(`no item id in ${itemUrl}`);
  const token = await page.evaluate(() =>
    localStorage.getItem("dlh.devSessionToken"),
  );
  if (!token) throw new Error("no dev session token in localStorage");
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
    title: renamed,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: renamed }),
  ).toBeVisible({ timeout: 2000 });
});
