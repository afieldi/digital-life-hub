import { expect, type Page } from "@playwright/test";

/** Browser-mode sign-in through the dev-only `auth.devSignIn` button. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in (dev)" }).click();
  await expect(page.getByTestId("greeting")).toBeVisible();
}
