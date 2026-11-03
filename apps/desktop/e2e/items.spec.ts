import { expect, test } from "@playwright/test";
import { apiFor, taskPanel } from "./api";
import { openPalette } from "./palette";
import { signIn } from "./signIn";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("find, recent and live rename of an item", async ({ page }, testInfo) => {
  // The database is shared by both browser projects and never wiped between
  // them, so every title is unique to this run.
  const stamp = `${testInfo.project.name} ${Date.now()}`;
  const title = `E2E item ${stamp}`;
  const renamed = `E2E renamed ${stamp}`;

  await signIn(page);
  const api = await apiFor(page);
  const { result: task } = await api.tasks.create.mutate({ title });

  // Search finds it and opens its page.
  await openPalette(page);
  await page.getByRole("combobox").fill(stamp);
  await page.getByRole("option", { name: title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(taskPanel(page, title)).toBeVisible();

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

  // A rename made elsewhere through Core reaches the open page through /changes.
  await page.goto(`/tasks/${task.id}`);
  await expect(taskPanel(page, title)).toBeVisible();
  const current = await api.items.get.query({ id: task.id });
  await api.items.rename.mutate({
    id: task.id,
    expectedUpdatedAt: current.updatedAt,
    title: renamed,
  });
  await expect(taskPanel(page, renamed)).toBeVisible({ timeout: 2000 });
});
