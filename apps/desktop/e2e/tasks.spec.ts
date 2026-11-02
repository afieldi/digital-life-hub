import type { AppRouter } from "@dlh/api/router";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { parseDue } from "../../../modules/tasks/src/capture";
import { E2E_API_URL } from "./apiUrl";
import { modEnter } from "./keys";
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

/** The API as the signed-in page, for setting up tasks and acting elsewhere. */
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

/** The browser's zone: the device zone the app reads days in. */
const browserZone = (page: Page) =>
  page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

/** The date "friday" means right now, as the app reads it. */
async function friday(page: Page): Promise<string> {
  const due = parseDue("friday", {
    now: new Date(),
    timeZone: await browserZone(page),
  });
  if (!due || !("date" in due)) throw new Error("no friday");
  return due.date;
}

/** The command bar's input (a Detail panel has search fields of its own). */
const bar = (page: Page) =>
  page.getByRole("combobox", { name: "Search, create, or ask AI" });

/**
 * Types `text` into ⌘K and chooses the row named `name` with ↵ once the
 * search for the text is in, so rows arriving late can't shift what is
 * chosen. Resolves to the row's text.
 */
async function choose(page: Page, text: string, name: RegExp) {
  await openPalette(page);
  await bar(page).fill(text);
  const row = page.getByRole("option", { name });
  const jump = page.getByRole("group", { name: "Jump to" });
  await expect(
    jump.getByRole("option").first().or(jump.getByText("No items match")),
  ).toBeVisible();
  await expect(row).toHaveAttribute("aria-selected", "true");
  const label = (await row.textContent()) ?? "";
  await page.keyboard.press("Enter");
  return label;
}

/** A toast showing `text`. */
const toastWith = (page: Page, text: string | RegExp) =>
  page.getByRole("alertdialog").filter({
    has: page.getByRole("status").getByText(text, { exact: true }),
  });

/** Makes a task through the API and opens its Detail panel. */
async function openNewTask(page: Page, title: string) {
  const api = await apiFor(page);
  const { result: task } = await api.tasks.create.mutate({ title });
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole("complementary", { name: title })).toBeVisible();
  return { api, task };
}

test("quick add lands under Today with High; tick and Undo", async ({
  page,
}, testInfo) => {
  const title = `Call the bank ${stamp(testInfo)}`;
  await signIn(page);
  await page.goto("/tasks");

  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill(`${title} today 9am !`);
  await add.press("Enter");
  await expect(add).toHaveValue("");

  const today = page.getByRole("region", { name: /^Today\b/ });
  const row = today.locator("[data-task-id]").filter({
    has: page.getByRole("link", { name: title, exact: true }),
  });
  await expect(row).toBeVisible();
  await expect(row.getByText("High", { exact: true })).toBeVisible();

  // The input is visually hidden: press the box drawn in its label.
  await row
    .locator("label", {
      has: page.getByRole("checkbox", { name: `Complete: ${title}` }),
    })
    .click();
  await expect(
    row.getByRole("checkbox", { name: `Mark not done: ${title}` }),
  ).toBeChecked();
  await toastWith(page, "Complete")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByText("Undid complete")).toBeVisible();
  await expect(
    row.getByRole("checkbox", { name: `Complete: ${title}` }),
  ).not.toBeChecked();
});

test("⌘K Reschedule friday moves the open task", async ({ page }, testInfo) => {
  const title = `Reschedule me ${stamp(testInfo)}`;
  await signIn(page);
  const { api, task } = await openNewTask(page, title);
  const date = await friday(page);

  await choose(page, "Reschedule friday", /^Reschedule to /);
  await expect(
    toastWith(page, /^Reschedule to /).getByRole("button", { name: "Undo" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await api.tasks.get.query({ id: task.id })).task.due)
    .toEqual({ date });
});

test("⌘K Make subtask of… nests the open task", async ({ page }, testInfo) => {
  const run = stamp(testInfo);
  const parent = `Parent task ${run}`;
  const child = `Child task ${run}`;
  await signIn(page);
  const api = await apiFor(page);
  await api.tasks.create.mutate({ title: parent });
  await openNewTask(page, child);

  await choose(page, "Make subtask of", /^Make subtask of/);
  const form = page.getByRole("dialog", { name: "Make subtask of…" });
  const field = form.getByRole("combobox", { name: "Parent task" });
  await field.fill(parent);
  await page.getByRole("option", { name: new RegExp(`^${parent}`) }).click();
  await form.getByRole("button", { name: "Run" }).click();
  await expect(toastWith(page, "Make subtask")).toBeVisible();

  const detail = page.getByRole("complementary", { name: child });
  const subtaskOf = detail.getByRole("region", { name: /^Subtask of\b/ });
  await expect(subtaskOf.getByRole("link", { name: parent })).toBeVisible();
  await subtaskOf.getByRole("link", { name: parent }).click();
  const parentDetail = page.getByRole("complementary", { name: parent });
  await expect(
    parentDetail
      .getByRole("region", { name: /^Subtasks\b/ })
      .getByRole("link", { name: child }),
  ).toBeVisible();
});

test("⌘K due friday lists a task due Friday, no AI", async ({
  page,
}, testInfo) => {
  const title = `Due friday ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  await api.tasks.create.mutate({ title, due: { date: await friday(page) } });
  await page.goto("/tasks");
  // ⌘K is listened for once the screen is up.
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  const heading = await choose(page, "due friday", /^Due \w+, \w+ \d+$/);
  const result = page.getByRole("heading", { name: heading }).locator("..");
  await expect(
    result.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();
  // Run as a plain read: the bar never went on to ask AI.
  await expect(page.getByText("Understood as")).toHaveCount(0);
});

test("⌘↵ what's due friday asks AI and lists the task", async ({
  page,
}, testInfo) => {
  const title = `Ask due ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  await api.tasks.create.mutate({ title, due: { date: await friday(page) } });
  await page.goto("/tasks");
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  await openPalette(page);
  await bar(page).fill("what's due friday?");
  await expect(page.getByText("Understood as")).toBeVisible();
  await expect(page.getByText("Due", { exact: true })).toBeVisible();
  await modEnter(page);
  // The fake model fills the next seven days, which hold Friday.
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();
});

test("dragging a card in Upcoming moves it to that day", async ({
  page,
  browserName,
}, testInfo) => {
  // In Linux WebKit (WebKitGTK), React Aria's keyboard drag handles only the
  // first Tab; later Tabs move browser focus without it, so ↵ never drops.
  // Linux isn't a target (the app ships on macOS WebKit and Windows WebView2),
  // and the board's keyboard move is also covered in macOS WebKit by
  // packages/ui's "board keyboard move" test.
  test.skip(
    browserName === "webkit" && process.platform === "linux",
    "React Aria keyboard drag doesn't work in Linux WebKit",
  );
  const title = `Drag me ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  // Next week, so every day of it is still ahead whatever today is.
  const nextMonday = await page.evaluate(() => {
    const day = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  });
  const wednesday = (() => {
    const d = new Date(`${nextMonday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 2);
    return d.toISOString().slice(0, 10);
  })();
  const { result: task } = await api.tasks.create.mutate({
    title,
    due: { date: nextMonday },
  });
  await page.goto(`/tasks/upcoming?week=${nextMonday}`);

  const column = (day: string) =>
    page.getByRole("grid", { name: new RegExp(` ${Number(day.slice(8))}$`) });
  const from = column(nextMonday);
  const to = column(wednesday);
  const card = from.getByRole("row").filter({ hasText: title });
  await expect(card).toBeVisible();

  // RAC GridList starts keyboard drags from the card's drag button.
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    card.getByRole("button", { name: `Drag ${title}` }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  // Tab moves between drop targets until one is inside Wednesday.
  for (let i = 0; i < 40; i++) {
    if (await to.evaluate((el) => el.contains(document.activeElement))) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");

  await expect(to.getByText(title, { exact: true })).toBeVisible();
  await expect(from.getByText(title, { exact: true })).toHaveCount(0);
  await expect
    .poll(async () => (await api.tasks.get.query({ id: task.id })).task.due)
    .toEqual({ date: wednesday });
});

test("a task completed elsewhere updates the open screen within 2 seconds", async ({
  page,
}, testInfo) => {
  const title = `Done elsewhere ${stamp(testInfo)}`;
  await signIn(page);
  const api = await apiFor(page);
  const { result: task } = await api.tasks.create.mutate({ title });
  await page.goto("/tasks");
  const box = page.locator(`[data-task-id="${task.id}"]`).getByRole("checkbox");
  await expect(box).not.toBeChecked();

  await api.tasks.complete.mutate({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  await expect(box).toBeChecked({ timeout: 2000 });
});

test("⌘↵ break this into subtasks adds three; Undo removes them", async ({
  page,
}, testInfo) => {
  const title = `Plan the trip ${stamp(testInfo)}`;
  await signIn(page);
  const { api, task } = await openNewTask(page, title);
  const subtasks = async () =>
    (await api.tasks.get.query({ id: task.id })).subtasks.map((s) => s.title);

  await openPalette(page);
  await bar(page).fill("break this into subtasks");
  await expect(page.getByText("Understood as")).toBeVisible();
  await expect(page.getByText("Break down", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Do" }).click();
  await modEnter(page);

  await expect(toastWith(page, "Added 3 subtasks")).toBeVisible();
  const detail = page.getByRole("complementary", { name: title });
  for (const n of ["One", "Two", "Three"]) {
    await expect(
      detail.getByRole("link", { name: `Fake subtask ${n}` }),
    ).toBeVisible();
  }
  expect((await subtasks()).sort()).toEqual([
    "Fake subtask One",
    "Fake subtask Three",
    "Fake subtask Two",
  ]);

  await toastWith(page, "Added 3 subtasks")
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByText("Undid break down")).toBeVisible();
  await expect(detail.getByRole("link", { name: /^Fake subtask/ })).toHaveCount(
    0,
  );
  expect(await subtasks()).toEqual([]);
});
