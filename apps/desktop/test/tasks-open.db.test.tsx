import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { dismissToasts, freshApiDb, signedInApp } from "./apiHarness";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  // Dismiss toasts while the region is still mounted, then unmount.
  await dismissToasts();
  cleanup();
  await Promise.all(closers.splice(0).map((close) => close()));
});

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A day in the device's zone, `offset` days from today. */
function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
}

async function setup(opts: Parameters<typeof signedInApp>[1] = {}): Promise<
  Awaited<ReturnType<typeof signedInApp>> & {
    client: ReturnType<
      Awaited<ReturnType<typeof signedInApp>>["api"]["client"]
    >;
  }
> {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp("/tasks", { ...opts, db: t.db });
  return { ...app, client: app.api.client(app.token) };
}

const group = (name: string) =>
  screen.findByRole("region", { name: new RegExp(`^${name}`) });

test('quick add "Call the bank today 9am !" shows it under Today with High', async () => {
  const { renderApp, client } = await setup();
  renderApp();
  const input = await screen.findByRole("textbox", { name: "Add a task" });
  await userEvent.type(input, "Call the bank today 9am !{Enter}");
  const today = await group("Today");
  expect(await within(today).findByText("Call the bank")).toBeInTheDocument();
  expect(within(today).getByText("High")).toBeInTheDocument();
  await waitFor(() => expect(input).toHaveValue(""));
  const { rows } = await client.tasks.list.query({
    view: "open",
    timeZone: zone,
  });
  expect(rows).toMatchObject([{ title: "Call the bank", priority: "high" }]);
});

test("quick add highlights what it read", async () => {
  const { renderApp } = await setup();
  renderApp();
  const input = await screen.findByRole("textbox", { name: "Add a task" });
  await userEvent.type(input, "Pay rent tomorrow p1");
  const marks = await screen.findAllByTestId("capture-highlight");
  expect(marks.map((m) => m.textContent)).toEqual(["tomorrow", "p1"]);
});

test("ticking moves it to struck-through and Undo restores", async () => {
  const { renderApp, client } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Water the plants",
    due: { date: dayFromToday(0) },
  });
  renderApp();
  await userEvent.click(
    await screen.findByRole("checkbox", { name: "Complete: Water the plants" }),
  );
  const today = await group("Today");
  const done = await within(today).findByRole("checkbox", {
    name: "Mark not done: Water the plants",
  });
  expect(done).toBeChecked();
  expect(within(today).getByText("Water the plants")).toHaveStyle({
    textDecorationLine: "line-through",
  });
  await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(
    await screen.findByRole("checkbox", { name: "Complete: Water the plants" }),
  ).not.toBeChecked();
  const { task: after } = await client.tasks.get.query({ id: task.id });
  expect(after.completedAt).toBeNull();
});

test("tick then untick at once ends open, with no conflict", async () => {
  const { renderApp, client } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Quick change",
  });
  renderApp();
  const box = await screen.findByRole("checkbox", {
    name: "Complete: Quick change",
  });
  fireEvent.click(box);
  // The tick shows at once; untick before the first write is back.
  fireEvent.click(
    await screen.findByRole("checkbox", {
      name: "Mark not done: Quick change",
    }),
  );
  expect(
    await screen.findByRole("checkbox", { name: "Complete: Quick change" }),
  ).not.toBeChecked();
  await waitFor(() =>
    expect(screen.getAllByText("Reopen").length).toBeGreaterThan(0),
  );
  expect(screen.queryByText("Changed since")).toBeNull();
  const { task: after } = await client.tasks.get.query({ id: task.id });
  expect(after.completedAt).toBeNull();
});

test("X pressed twice ends open, with no conflict", async () => {
  const { renderApp, client } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Twice",
  });
  renderApp();
  const box = await screen.findByRole("checkbox", { name: "Complete: Twice" });
  box.focus();
  fireEvent.keyDown(box, { key: "x" });
  fireEvent.keyDown(box, { key: "x" });
  await waitFor(() =>
    expect(screen.getAllByText("Reopen").length).toBeGreaterThan(0),
  );
  expect(screen.queryByText("Changed since")).toBeNull();
  const { task: after } = await client.tasks.get.query({ id: task.id });
  expect(after.completedAt).toBeNull();
});

test('ticking the last subtask offers "All subtasks done. Complete the task?"', async () => {
  const { renderApp, client } = await setup();
  const { result: parent } = await client.tasks.create.mutate({
    title: "Plan the trip",
  });
  await client.tasks.create.mutate({
    title: "Book flights",
    due: { date: dayFromToday(0) },
    parentId: parent.id,
  });
  renderApp();
  const today = await group("Today");
  expect(within(today).getByText(/in Plan the trip/)).toBeInTheDocument();
  expect(
    within(await group("No date")).getByText(/0\/1 · Next: Book flights/),
  ).toBeInTheDocument();
  await userEvent.click(
    within(today).getByRole("checkbox", { name: "Complete: Book flights" }),
  );
  expect(
    await screen.findByText("All subtasks done. Complete the task?"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Complete" }));
  await waitFor(async () => {
    const { task } = await client.tasks.get.query({ id: parent.id });
    expect(task.completedAt).not.toBeNull();
  });
});

test("Reschedule all moves overdue to today", async () => {
  const { renderApp, client } = await setup();
  for (const title of ["Renew insurance", "Send invoice"]) {
    await client.tasks.create.mutate({
      title,
      due: { date: dayFromToday(-2) },
    });
  }
  renderApp();
  const overdue = await group("Overdue");
  expect(within(overdue).getByText("Renew insurance")).toBeInTheDocument();
  await userEvent.click(
    within(overdue).getByRole("button", { name: "Reschedule all" }),
  );
  const today = await group("Today");
  expect(await within(today).findByText("Renew insurance")).toBeInTheDocument();
  expect(within(today).getByText("Send invoice")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: /^Overdue/ })).toBeNull();
  const { rows } = await client.tasks.list.query({
    view: "open",
    timeZone: zone,
  });
  expect(rows.map((r) => r.due)).toEqual([
    { date: dayFromToday(0) },
    { date: dayFromToday(0) },
  ]);
});

test("Reschedule all with High only still moves every overdue task", async () => {
  const { renderApp, client } = await setup();
  await client.tasks.create.mutate({
    title: "Urgent late",
    priority: "high",
    due: { date: dayFromToday(-1) },
  });
  await client.tasks.create.mutate({
    title: "Routine late",
    due: { date: dayFromToday(-1) },
  });
  renderApp();
  await group("Overdue");
  await userEvent.click(
    screen.getByRole("switch", { name: "High priority only" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reschedule all" }));
  await waitFor(async () => {
    const { rows } = await client.tasks.list.query({
      view: "open",
      timeZone: zone,
    });
    expect(rows.map((r) => r.day)).toEqual([dayFromToday(0), dayFromToday(0)]);
  });
});

test("High only hides medium tasks", async () => {
  const { renderApp, client } = await setup();
  await client.tasks.create.mutate({ title: "Urgent fix", priority: "high" });
  await client.tasks.create.mutate({ title: "Routine chore" });
  renderApp();
  expect(await screen.findByText("Routine chore")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("switch", { name: "High priority only" }),
  );
  await waitFor(() => expect(screen.queryByText("Routine chore")).toBeNull());
  expect(screen.getByText("Urgent fix")).toBeInTheDocument();
});

test("N focuses quick add, X completes the focused row", async () => {
  const { renderApp, client } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Stretch",
  });
  renderApp();
  const box = await screen.findByRole("checkbox", {
    name: "Complete: Stretch",
  });
  const input = screen.getByRole("textbox", { name: "Add a task" });
  await userEvent.keyboard("n");
  expect(input).toHaveFocus();
  expect(input).toHaveValue("");
  box.focus();
  fireEvent.keyDown(box, { key: "x" });
  await waitFor(async () => {
    const { task: after } = await client.tasks.get.query({ id: task.id });
    expect(after.completedAt).not.toBeNull();
  });
});

test("Enter on a focused row opens it", async () => {
  const { renderApp, client, router } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Read a book",
  });
  renderApp();
  const box = await screen.findByRole("checkbox", {
    name: "Complete: Read a book",
  });
  box.focus();
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/tasks/${task.id}`),
  );
});

test('empty shows "Nothing open. Add one above"', async () => {
  const { renderApp } = await setup();
  renderApp();
  expect(
    await screen.findByText("Nothing open. Add one above"),
  ).toBeInTheDocument();
});

test("a conflicting tick refetches and toasts", async () => {
  let rename: (() => Promise<unknown>) | undefined;
  const { renderApp, client } = await setup({
    wrapFetch: (inner) => async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      // Someone renames the task just before the tick reaches the server.
      if (url.includes("/trpc/tasks.complete") && rename) {
        await rename();
        rename = undefined;
      }
      return inner(input, init);
    },
  });
  const { result: task } = await client.tasks.create.mutate({
    title: "Old title",
  });
  rename = () =>
    client.tasks.update.mutate({
      id: task.id,
      expectedUpdatedAt: task.updatedAt,
      title: "New title",
    });
  renderApp();
  await userEvent.click(
    await screen.findByRole("checkbox", { name: "Complete: Old title" }),
  );
  expect(await screen.findByText("Changed since")).toBeInTheDocument();
  expect(
    await screen.findByRole("checkbox", { name: "Complete: New title" }),
  ).not.toBeChecked();
});

test("ticking a task that is already done offers no Undo", async () => {
  const { renderApp, client } = await setup();
  const { result: task } = await client.tasks.create.mutate({
    title: "Done elsewhere",
  });
  renderApp();
  const box = await screen.findByRole("checkbox", {
    name: "Complete: Done elsewhere",
  });
  // Another device completes it before this tick reaches the server.
  await client.tasks.complete.mutate({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  await userEvent.click(box);
  const toastText = await screen.findByText("Complete");
  expect(toastText).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByText("Changed since")).toBeNull();
});

test("tick on Open, then ⌘K Reopen at once: no conflict", async () => {
  // Once ticked, reads of items are slow: ⌘K must not act on the version it
  // read before the tick.
  let slow = false;
  const { renderApp, client, router } = await setup({
    wrapFetch: (inner) => async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (slow && url.includes("items.get")) {
        await new Promise((r) => setTimeout(r, 400));
      }
      return inner(input, init);
    },
  });
  const { result: task } = await client.tasks.create.mutate({
    title: "Water the fern",
  });
  renderApp();
  router.history.push(`/tasks/${task.id}`);
  await screen.findByRole("complementary", { name: "Water the fern" });
  // ⌘K has read the open task's version once already.
  await userEvent.click(
    await screen.findByRole("button", { name: "Command bar" }),
  );
  await userEvent.type(await screen.findByRole("combobox"), "Reopen");
  await screen.findByRole("option", { name: "Reopen" });
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Command bar" })).toBeNull(),
  );

  const [box] = await screen.findAllByRole("checkbox", {
    name: "Complete: Water the fern",
  });
  if (!box) throw new Error("no checkbox");
  slow = true;
  await userEvent.click(box);
  await screen.findByRole("button", { name: "Undo" });

  await userEvent.click(screen.getByRole("button", { name: "Command bar" }));
  const input = await screen.findByRole("combobox");
  await userEvent.clear(input);
  await userEvent.type(input, "Reopen");
  await screen.findByRole("option", { name: "Reopen" });
  await userEvent.keyboard("{Enter}");
  await waitFor(async () => {
    const { task: after } = await client.tasks.get.query({ id: task.id });
    expect(after.completedAt).toBeNull();
  });
  expect(screen.queryByText("Changed since")).toBeNull();
});
