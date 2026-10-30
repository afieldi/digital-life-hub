import { expect, test } from "@playwright/test";
import { signIn } from "./signIn";

const signInButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Sign in (dev)" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("dev sign-in survives a reload", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByTestId("greeting")).toBeVisible();
  await expect(signInButton(page)).toHaveCount(0);
});

test("Sign out from Settings → Devices returns to sign-in", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out of this device?" });
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(signInButton(page)).toBeVisible();
  await page.reload();
  await expect(signInButton(page)).toBeVisible();
});
