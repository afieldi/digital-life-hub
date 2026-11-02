import { isMac } from "@dlh/ui";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { parseDue } from "../../../modules/tasks/src/capture";
import { freshApiDb, signedInApp } from "./apiHarness";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  // Toasts live in a module-level queue that outlives each render: dismiss
  // them while the region is still mounted, then unmount.
  for (const b of screen.queryAllByRole("button", { name: "Dismiss" })) {
    fireEvent.click(b);
  }
  await waitFor(() =>
    expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(
      0,
    ),
  );
  cleanup();
  await Promise.all(closers.splice(0).map((close) => close()));
});

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The app signed in, with a task "Pay rent". With `taskOpen`, the task is the
 * open item: there is no Tasks screen yet, so the sample item page, which
 * marks whatever id it shows as open, stands in for it.
 */
async function setup(opts: { taskOpen?: boolean } = {}) {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp("/", { db: t.db });
  const client = app.api.client(app.token);
  const { result: task } = await client.tasks.create.mutate({
    title: "Pay rent",
  });
  if (opts.taskOpen) app.router.history.push(`/sample/${task.id}`);
  app.renderApp();
  if (opts.taskOpen) {
    await screen.findByRole("heading", { name: "Pay rent", level: 1 });
  }
  const read = async () =>
    (await client.tasks.get.query({ id: task.id, timeZone })).task;
  return { ...app, client, task, read };
}

async function type(text: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Command bar" }),
  );
  const input = await screen.findByRole("combobox");
  await userEvent.type(input, text);
  return input;
}

/** Waits for the search for the typed text, so ↵ goes to the rows. */
const settled = () =>
  waitFor(() => {
    const jump = screen.getByRole("group", { name: "Jump to" });
    expect(
      within(jump).queryByText("No items match") ??
        within(jump).queryAllByRole("option")[0],
    ).toBeTruthy();
  });

const modEnter = () =>
  userEvent.keyboard(
    isMac() ? "{Meta>}{Enter}{/Meta}" : "{Control>}{Enter}{/Control}",
  );

test("complete runs on enter with a task open and toasts Undo", async () => {
  const { read } = await setup({ taskOpen: true });
  await type("complete");
  expect(await screen.findByRole("option", { name: "Complete" })).toBe(
    screen.getAllByRole("option")[0],
  );
  await settled();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(screen.getByText("Complete")).toBeInTheDocument();
  await waitFor(async () => expect((await read()).completedAt).not.toBeNull());
});

test("Undo reopens it", async () => {
  const { read } = await setup({ taskOpen: true });
  await type("complete");
  await settled();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undid complete")).toBeInTheDocument();
  expect((await read()).completedAt).toBeNull();
});

test('"Reschedule friday" shows the summary and moves the task', async () => {
  const { read } = await setup({ taskOpen: true });
  await type("Reschedule friday");
  const friday = parseDue("friday", { now: new Date(), timeZone });
  if (!friday || !("date" in friday)) throw new Error("no friday");
  const row = await screen.findByRole("option", {
    name: /^Reschedule to \w+, \w+ \d+$/,
  });
  expect(row).toBe(screen.getAllByRole("option")[0]);
  await settled();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
  await waitFor(async () => expect((await read()).due).toEqual(friday));
});

test('"Reschedule" alone says Type a date and ↵ opens the form', async () => {
  await setup({ taskOpen: true });
  await type("Reschedule");
  expect(
    await screen.findByRole("option", { name: /^Reschedule\s*Type a date$/ }),
  ).toBe(screen.getAllByRole("option")[0]);
  await settled();
  await userEvent.keyboard("{Enter}");
  const form = await screen.findByRole("dialog", { name: "Reschedule" });
  expect(within(form).getByRole("button", { name: "Run" })).toBeDisabled();
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("create row not ready without a title", async () => {
  await setup();
  await type("New task");
  expect(
    await screen.findByRole("option", { name: /^New task\s*Add a title$/ }),
  ).toBeInTheDocument();
});

test('"New task Call the bank tomorrow p1" creates it', async () => {
  const { client } = await setup();
  await type("New task Call the bank tomorrow p1");
  const row = await screen.findByRole("option", {
    name: /^New task Call the bank, \w+, \w+ \d+$/,
  });
  expect(row).toBe(screen.getAllByRole("option")[0]);
  await settled();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
  const tomorrow = parseDue("tomorrow", { now: new Date(), timeZone });
  const found = await client.search.query({ query: "Call the bank" });
  const created = found.find((i) => i.title === "Call the bank");
  if (!created) throw new Error("not created");
  const { task: row2 } = await client.tasks.get.query({
    id: created.id,
    timeZone,
  });
  expect(row2.due).toEqual(tomorrow);
  expect(row2.priority).toBe("high");
});

test('"due friday" lists tasks in the result slot', async () => {
  const { client, router, task } = await setup();
  const friday = parseDue("friday", { now: new Date(), timeZone });
  if (!friday) throw new Error("no friday");
  // Not due, so not listed.
  const { result: other } = await client.tasks.create.mutate({
    title: "Water plants",
  });
  await client.tasks.reschedule.mutate({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
    due: friday,
  });
  await type("due friday");
  const row = await screen.findByRole("option", { name: /^Due \w+, \w+ \d+$/ });
  expect(row).toBe(screen.getAllByRole("option")[0]);
  await settled();
  await userEvent.keyboard("{Enter}");
  const heading = await screen.findByRole("heading", { name: row.textContent });
  const result = heading.parentElement as HTMLElement;
  const open = within(result).getByRole("button", { name: /Pay rent/ });
  expect(within(result).queryByText(other.title)).toBeNull();
  await userEvent.click(open);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/tasks/${task.id}`),
  );
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("⌘↵ in a step asks AI with that action chosen", async () => {
  await setup();
  const input = await type("due");
  await settled();
  // No date yet: choosing the row enters its step rather than running it.
  await userEvent.keyboard("{Enter}");
  const stepRow = await screen.findByRole("option", {
    name: /^Due\s*Type a date$/,
  });
  expect(stepRow).toHaveAttribute("aria-disabled", "true");
  // Esc leaves the step and keeps the bar open.
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: /^Due\s*Type a date$/ }),
    ).not.toHaveAttribute("aria-disabled"),
  );
  expect(input).toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: /^Due\s*Type a date$/ }),
    ).toHaveAttribute("aria-disabled", "true"),
  );
  expect(screen.queryByText("Understood as")).toBeNull();
  await userEvent.type(input, " whenever");
  await modEnter();
  const understood = await screen.findByText("Understood as");
  expect(understood.parentElement).toHaveTextContent("Understood asDue");
});

test('"due friday" with a task open lists before it reschedules', async () => {
  const { read, task } = await setup({ taskOpen: true });
  await type("due friday");
  // Due is named by its label; Reschedule only by its word "due".
  const due = await screen.findByRole("option", { name: /^Due \w+, \w+ \d+$/ });
  expect(screen.getAllByRole("option")[0]).toBe(due);
  expect(
    screen.getByRole("option", { name: /^Reschedule to / }),
  ).toBeInTheDocument();
  await settled();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", { name: due.textContent }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  const after = await read();
  expect(after.due).toBeNull();
  expect(after.updatedAt).toBe(task.updatedAt);
});

test('"Reschedule" and "due" alone with a task open say Type a date', async () => {
  await setup({ taskOpen: true });
  const input = await type("Reschedule");
  expect(
    await screen.findByRole("option", { name: /^Reschedule\s*Type a date$/ }),
  ).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, "due");
  expect(
    await screen.findByRole("option", { name: /^Due\s*Type a date$/ }),
  ).toBe(screen.getAllByRole("option")[0]);
  expect(
    screen.getByRole("option", { name: /^Reschedule\s*Type a date$/ }),
  ).toBeInTheDocument();
});
