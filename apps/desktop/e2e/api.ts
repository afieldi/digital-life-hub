import type { AppRouter } from "@dlh/api/router";
import { expect, type Page } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { E2E_API_URL } from "./apiUrl";

/** The API as the signed-in page, for setting up items and acting elsewhere. */
export async function apiFor(page: Page) {
  const token = await page.evaluate(() =>
    localStorage.getItem("dlh.devSessionToken"),
  );
  if (!token) throw new Error("no dev session token in localStorage");
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${E2E_API_URL}/trpc`,
        headers: { Authorization: `Bearer ${token}` },
      }),
    ],
  });
}

/** The open task's Detail panel, named by its title. */
export const taskPanel = (page: Page, title: string) =>
  page.getByRole("complementary", { name: title });

/** Makes a task through the API and opens its Detail panel. */
export async function openNewTask(page: Page, title: string) {
  const api = await apiFor(page);
  const { result: task } = await api.tasks.create.mutate({ title });
  await page.goto(`/tasks/${task.id}`);
  await expect(taskPanel(page, title)).toBeVisible();
  return { api, task };
}
