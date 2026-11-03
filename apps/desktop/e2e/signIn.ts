import { expect, type Page } from "@playwright/test";

/** Browser-mode sign-in through the dev-only `auth.devSignIn` button. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in (dev)" }).click();
  await expect(page.getByTestId("greeting")).toBeVisible();
}

/**
 * Waits for the page's change feed to connect, so a write made from outside
 * the app after this reaches the screen through the feed.
 */
export async function changesLive(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-changes", "live");
}
