import type { AppRouter } from "@dlh/api/router";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { E2E_API_URL } from "./apiUrl";
import { openPalette } from "./palette";
import { signIn } from "./signIn";

// Both browser projects share one database that is never wiped between them,
// so every title carries a stamp unique to this run.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

/** Unique to this test run, even for repeats started in the same millisecond. */
const stamp = (testInfo: TestInfo) =>
  `${testInfo.project.name}-${testInfo.repeatEachIndex}-${Date.now()}`;

/** The API as the signed-in page: what a script or an integration would call. */
async function apiFor(page: Page) {
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

/** The command bar's input. */
const bar = (page: Page) =>
  page.getByRole("combobox", { name: "Search, create, or ask AI" });

/** A toast showing `text`. */
const toastWith = (page: Page, text: string | RegExp) =>
  page.getByRole("alertdialog").filter({
    has: page.getByRole("status").getByText(text, { exact: true }),
  });

/** An open request's row, once it is on screen. */
const rowOf = (page: Page, title: string) =>
  page.locator("[data-request-id]").filter({
    has: page.getByRole("link", { name: title, exact: true }),
  });

/** A row's outcome buttons show on hover or focus: bring them up, then press one. */
async function press(page: Page, title: string, button: string) {
  const row = rowOf(page, title);
  await row.hover();
  await row.getByRole("button", { name: `${button}: ${title}` }).click();
}

test("⌘K files a request; Make task makes a linked task and resolves it", async ({
  page,
}, testInfo) => {
  const title = `Look at the lease ${stamp(testInfo)}`;
  await signIn(page);
  await page.goto("/queue");
  await expect(
    page.getByRole("region", { name: "Open requests" }),
  ).toBeVisible();

  await openPalette(page);
  await bar(page).fill("File a request");
  const option = page.getByRole("option", { name: /^File a request/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  const form = page.getByRole("dialog", { name: "File a request" });
  await form.getByRole("textbox", { name: "Title" }).fill(title);
  await form.getByRole("button", { name: "Run" }).click();
  await expect(toastWith(page, `File a request: ${title}`)).toBeVisible();
  await expect(rowOf(page, title)).toBeVisible();

  await press(page, title, "Make task");
  const make = page.getByRole("dialog", { name: "Make task" });
  await expect(make.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await make.getByRole("button", { name: "Run" }).click();
  // The row leaves Open at once; the toast says the write has gone through.
  await expect(toastWith(page, "Make task")).toBeVisible();
  await expect(rowOf(page, title)).toHaveCount(0);

  // The task is in Tasks.
  const api = await apiFor(page);
  await page.goto("/tasks");
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible();

  // The request is in Resolved, and its Detail links to the task.
  await page.goto("/queue/resolved");
  const resolved = page
    .locator("[data-request-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(resolved).toBeVisible();
  // The row's task chip carries the same title: take the request's own link.
  await resolved.locator('a[href^="/queue/"]').click();
  const detail = page.getByRole("complementary", { name: title });
  const taskLink = detail.getByRole("link", { name: title, exact: true });
  await expect(taskLink).toBeVisible();
  await expect(taskLink).toHaveAttribute("href", /\/tasks\//);

  const { rows } = await api.requests.resolved.query({});
  expect(rows.filter((r) => r.title === title)).toHaveLength(1);
});

test("Not for me, then Undo, puts it back in Open", async ({
  page,
}, testInfo) => {
  const title = `Not mine ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  await api.requests.file.mutate({ title });
  await page.goto("/queue");
  await expect(rowOf(page, title)).toBeVisible();

  await press(page, title, "Not for me");
  await expect(rowOf(page, title)).toHaveCount(0);
  await toastWith(page, "Not for me")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(rowOf(page, title)).toBeVisible();
});

test("a script files a request through the API and Open shows it within 2 seconds", async ({
  page,
}, testInfo) => {
  const title = `From Slack ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  await page.goto("/queue");
  await expect(
    page.getByRole("region", { name: "Open requests" }),
  ).toBeVisible();

  await api.requests.file.mutate({
    title,
    source: "slack",
    fromName: "Maya Chen",
    externalId: `e2e:${stamp(testInfo)}`,
  });
  await expect(rowOf(page, title)).toBeVisible({ timeout: 2000 });
});

test("filing the same externalId twice through the API gives one row", async ({
  page,
}, testInfo) => {
  const run = stamp(testInfo);
  const title = `Twice ${run}`;
  await signIn(page);
  const api = await apiFor(page);
  const input = {
    title,
    source: "slack" as const,
    externalId: `e2e-dup:${run}`,
  };
  const first = await api.requests.file.mutate(input);
  const second = await api.requests.file.mutate(input);
  expect(second.result.request.id).toBe(first.result.request.id);

  const { items } = await api.requests.open.query({});
  expect(items.filter((r) => r.title === title)).toHaveLength(1);
  await page.goto("/queue");
  await expect(rowOf(page, title)).toHaveCount(1);
});
