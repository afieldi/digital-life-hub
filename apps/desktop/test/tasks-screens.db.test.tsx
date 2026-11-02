import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { freshApiDb, signedInApp } from "./apiHarness";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
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

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A day in the device's zone, `offset` days from today. */
function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
}

/** The Monday of the week holding `day`, and the days after it. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** "Thu 5", as an Upcoming column is titled. */
function columnTitle(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(d);
  return `${dow} ${d.getUTCDate()}`;
}

async function setup(path: string) {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp(path, { db: t.db });
  return { ...app, db: t.db, client: app.api.client(app.token) };
}

const column = (day: string) =>
  screen.findByRole("region", {
    name: new RegExp(`^${columnTitle(day)}\\b`),
  });

/** The Detail panel, named by its task's title. */
const panel = (title: string) =>
  screen.findByRole("complementary", { name: title });

describe("tabs and status", () => {
  test("tabs link the three views and count open and upcoming", async () => {
    const { renderApp, client, router } = await setup("/tasks");
    await client.tasks.create.mutate({
      title: "Today one",
      due: { date: dayFromToday(0) },
    });
    await client.tasks.create.mutate({ title: "Undated" });
    renderApp();
    const nav = await screen.findByRole("navigation", { name: "Task views" });
    const open = await within(nav).findByRole("link", { name: "Open · 2" });
    expect(open).toHaveAttribute("aria-current", "page");
    expect(
      await within(nav).findByRole("link", { name: "Upcoming · 1" }),
    ).not.toHaveAttribute("aria-current");
    expect(await screen.findByText("1 thing left today")).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("link", { name: "Done" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tasks/done"),
    );
    expect(
      await within(
        await screen.findByRole("navigation", { name: "Task views" }),
      ).findByRole("link", { name: "Done", current: "page" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("0 done this week")).toBeInTheDocument();
  });

  test('"Today is clear" when nothing open today', async () => {
    const { renderApp, client } = await setup("/tasks");
    await client.tasks.create.mutate({
      title: "Late",
      due: { date: dayFromToday(-3) },
    });
    renderApp();
    expect(
      await screen.findByText("Today is clear · 1 overdue"),
    ).toBeInTheDocument();
  });
});

describe("Upcoming", () => {
  test("upcoming drag reschedules", async () => {
    const today = dayFromToday(0);
    const monday = mondayOf(today);
    const from = monday;
    const to = plusDays(monday, 3);
    const { renderApp, client } = await setup("/tasks/upcoming");
    const { result: task } = await client.tasks.create.mutate({
      title: "Call Mum",
      // 9:00 on Monday in the device's zone (jsdom's local zone).
      due: {
        dateTime: new Date(`${from}T09:00:00`).toISOString(),
        timeZone: zone,
      },
    });
    renderApp();
    const start = await column(from);
    const drag = await within(start).findByRole("button", {
      name: /Drag Call Mum/,
    });
    // A keyboard drag: Enter picks the card up, Tab walks drop targets, Enter drops.
    fireEvent.keyDown(drag, { key: "Enter" });
    fireEvent.keyUp(drag, { key: "Enter" });
    const target = within(await column(to)).getByRole("grid");
    for (let i = 0; i < 20 && !target.contains(document.activeElement); i++) {
      await userEvent.tab();
    }
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    fireEvent.keyUp(document.activeElement as Element, { key: "Enter" });
    await waitFor(async () => {
      const { task: after } = await client.tasks.get.query({
        id: task.id,
        timeZone: zone,
      });
      expect(after.day).toBe(to);
    });
    const { task: after } = await client.tasks.get.query({
      id: task.id,
      timeZone: zone,
    });
    // Same wall-clock time on the new day.
    expect(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      }).format(new Date((after.due as { dateTime: string }).dateTime)),
    ).toBe("09:00");
  });

  test("Add on a day prefills its date", async () => {
    const day = plusDays(mondayOf(dayFromToday(0)), 3);
    const { renderApp, client } = await setup("/tasks/upcoming");
    renderApp();
    await userEvent.click(
      within(await column(day)).getByRole("button", { name: "Add" }),
    );
    const input = await screen.findByRole("textbox", { name: "Add a task" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "Buy milk{Enter}");
    expect(
      await within(await column(day)).findByText("Buy milk"),
    ).toBeInTheDocument();
    const { rows } = await client.tasks.list.query({
      view: "upcoming",
      timeZone: zone,
      weekOf: day,
    });
    expect(rows).toMatchObject([{ title: "Buy milk", due: { date: day } }]);
  });

  test("previous and next week", async () => {
    const monday = mondayOf(dayFromToday(0));
    const nextMonday = plusDays(monday, 7);
    const { renderApp, client } = await setup("/tasks/upcoming");
    await client.tasks.create.mutate({
      title: "Next week thing",
      due: { date: plusDays(nextMonday, 1) },
    });
    renderApp();
    const later = await screen.findByRole("region", { name: /^Later/ });
    expect(within(later).getByText("Next week thing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(
      await within(await column(plusDays(nextMonday, 1))).findByText(
        "Next week thing",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Previous week" }),
    );
    expect(await column(monday)).toBeInTheDocument();
  });
});

describe("Done", () => {
  test("done groups by completion day and Undo reopens", async () => {
    const { renderApp, client, db } = await setup("/tasks/done");
    // The test server's clock is fixed; completion times come from the
    // database's, so they fall on the device's today and yesterday.
    const make = async (title: string, ago: string) => {
      const { result } = await client.tasks.create.mutate({ title });
      await client.tasks.complete.mutate({
        id: result.id,
        expectedUpdatedAt: result.updatedAt,
      });
      await db.$client.unsafe(
        "update tasks set completed_at = now() - $2::interval where item_id = $1",
        [result.id, ago],
      );
      return result;
    };
    await make("Draft homepage copy", "0 seconds");
    await make("Fix the tap", "1 day");
    renderApp();
    const today = await screen.findByRole("region", { name: /^Today/ });
    expect(within(today).getByText("Draft homepage copy")).toBeInTheDocument();
    const yesterday = await screen.findByRole("region", {
      name: /^Yesterday/,
    });
    expect(within(yesterday).getByText("Fix the tap")).toBeInTheDocument();
    await userEvent.click(
      within(today).getByRole("button", { name: "Undo: Draft homepage copy" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Draft homepage copy")).toBeNull(),
    );
    await waitFor(async () => {
      const { rows } = await client.tasks.list.query({
        view: "open",
        timeZone: zone,
      });
      expect(rows.filter((r) => !r.completedAt).map((r) => r.title)).toEqual([
        "Draft homepage copy",
      ]);
    });
  });

  test('done empty "Nothing done yet"', async () => {
    const { renderApp } = await setup("/tasks/done");
    renderApp();
    expect(await screen.findByText("Nothing done yet")).toBeInTheDocument();
    expect(screen.getByText("Today is clear")).toBeInTheDocument();
  });
});

describe("Detail", () => {
  async function openDetail(
    title = "Review vendor contracts",
    extra: { priority?: "medium" | "high" } = {},
  ) {
    const app = await setup("/tasks");
    const { result: task } = await app.client.tasks.create.mutate({
      title,
      ...extra,
    });
    app.router.history.push(`/tasks/${task.id}`);
    app.renderApp();
    const p = await panel(title);
    expect(within(p).getByRole("heading", { name: title })).toBeInTheDocument();
    const read = async () =>
      (await app.client.tasks.get.query({ id: task.id, timeZone: zone })).task;
    return { ...app, task, panel: p, read };
  }

  test("detail sits over the list; Esc closes detail", async () => {
    const { router } = await openDetail();
    // The list stays behind it.
    expect(
      screen.getByRole("region", { name: "Open tasks" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/tasks"));
    expect(
      screen.queryByRole("complementary", { name: "Review vendor contracts" }),
    ).toBeNull();
  });

  test("opening records the view", async () => {
    const { client, task } = await openDetail();
    await waitFor(async () =>
      expect((await client.recents.list.query()).map((r) => r.id)).toContain(
        task.id,
      ),
    );
  });

  test("detail edits due, priority and notes", async () => {
    const { panel: p, read } = await openDetail();
    await userEvent.click(within(p).getByRole("radio", { name: "High" }));
    await waitFor(async () => expect((await read()).priority).toBe("high"));

    const notes = within(p).getByRole("textbox", { name: "Notes" });
    await userEvent.type(notes, "Check the SLA");
    // Nothing is sent while typing; it saves after a 500 ms pause.
    expect((await read()).notes).toBeNull();
    await waitFor(
      async () => expect((await read()).notes).toBe("Check the SLA"),
      {
        timeout: 3000,
      },
    );
    // Leaving the panel flushes a pending save.
    await userEvent.type(notes, ".");
    await userEvent.keyboard("{Escape}");
    await waitFor(async () =>
      expect((await read()).notes).toBe("Check the SLA."),
    );
  });

  test("detail edits due", async () => {
    const { panel: p, read } = await openDetail();
    const day = dayFromToday(2);
    const [y, m, d] = day.split("-");
    const group = within(p).getByRole("group", { name: "Due" });
    await userEvent.click(
      group.querySelector('[data-type="month"]') as HTMLElement,
    );
    await userEvent.keyboard(`${m}${d}${y}`);
    await waitFor(async () =>
      expect((await read()).due).toEqual({ date: day }),
    );
  });

  test("Subtask of chips remove and add parents", async () => {
    const app = await setup("/tasks");
    const { result: parent } = await app.client.tasks.create.mutate({
      title: "Q4 planning",
    });
    const { result: other } = await app.client.tasks.create.mutate({
      title: "Website relaunch",
    });
    const { result: task } = await app.client.tasks.create.mutate({
      title: "Hiring plan",
      parentId: parent.id,
    });
    app.router.history.push(`/tasks/${task.id}`);
    app.renderApp();
    const p = await panel("Hiring plan");
    const parents = await within(p).findByRole("region", {
      name: /^Subtask of/,
    });
    expect(within(parents).getByText("Q4 planning")).toBeInTheDocument();
    await userEvent.click(
      within(parents).getByRole("button", { name: "Remove from Q4 planning" }),
    );
    await waitFor(async () => {
      const { parents: now } = await app.client.tasks.get.query({
        id: task.id,
      });
      expect(now).toEqual([]);
    });
    await userEvent.click(
      within(parents).getByRole("button", { name: "Add to task…" }),
    );
    const search = within(parents).getByRole("combobox", {
      name: "Add to task",
    });
    await userEvent.type(search, "Website");
    await userEvent.click(
      await screen.findByRole("option", { name: /Website relaunch/ }),
    );
    await waitFor(async () => {
      const { parents: now } = await app.client.tasks.get.query({
        id: task.id,
      });
      expect(now.map((x) => x.id)).toEqual([other.id]);
    });
    expect(
      await within(parents).findByText("Website relaunch"),
    ).toBeInTheDocument();
  });

  test("add subtask and add existing", async () => {
    const { panel: p, client, task } = await openDetail();
    await client.tasks.create.mutate({ title: "Pull last year's contracts" });
    const subtasks = within(p).getByRole("region", { name: /^Subtasks/ });
    await userEvent.type(
      within(subtasks).getByRole("textbox", { name: "Add a subtask" }),
      "List questions for legal{Enter}",
    );
    expect(
      await within(subtasks).findByText("List questions for legal"),
    ).toBeInTheDocument();
    await userEvent.type(
      within(subtasks).getByRole("combobox", { name: "Add existing" }),
      "Pull last",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /Pull last year's contracts/ }),
    );
    await waitFor(async () => {
      const { subtasks: now } = await client.tasks.get.query({ id: task.id });
      expect(now.map((s) => s.title).sort()).toEqual([
        "List questions for legal",
        "Pull last year's contracts",
      ]);
    });
    // Ticking a subtask completes it.
    await userEvent.click(
      await within(subtasks).findByRole("checkbox", {
        name: "Complete: List questions for legal",
      }),
    );
    await waitFor(async () => {
      const { subtasks: now } = await client.tasks.get.query({ id: task.id });
      expect(
        now.find((s) => s.title === "List questions for legal")?.completedAt,
      ).not.toBeNull();
    });
  });

  test("⋯ lists the task's operations and AI actions", async () => {
    const { panel: p, read, client } = await openDetail("Second");
    await client.tasks.create.mutate({ title: "First" });
    await userEvent.click(
      within(p).getByRole("button", { name: "More actions" }),
    );
    const menu = await screen.findByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(labels).toEqual([
      "Complete",
      "Reschedule…",
      "Move to top",
      "Move to bottom",
      "Make subtask of…",
      "Delete",
      "Ask AI…",
    ]);
    const before = (await read()).sortKey;
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Move to bottom" }),
    );
    await waitFor(async () =>
      expect((await read()).sortKey > before).toBe(true),
    );

    await userEvent.click(
      within(p).getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Ask AI…" }),
    );
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });

  test("Linked lists links and backlinks", async () => {
    const app = await setup("/tasks");
    const make = async (title: string) =>
      (await app.client.tasks.create.mutate({ title })).result;
    const task = await make("Review vendor contracts");
    const waits = await make("Q4 budget pass");
    const from = await make("Vendor shortlist");
    await app.client.links.add.mutate({
      fromId: task.id,
      toId: waits.id,
      kind: "relates",
    });
    await app.client.links.add.mutate({
      fromId: from.id,
      toId: task.id,
      kind: "mentions",
    });
    app.router.history.push(`/tasks/${task.id}`);
    app.renderApp();
    const p = await panel("Review vendor contracts");
    const linked = await within(p).findByRole("region", { name: /^Linked/ });
    expect(
      await within(linked).findByRole("link", { name: "Q4 budget pass" }),
    ).toHaveAttribute("href", `/tasks/${waits.id}`);
    expect(within(linked).getByText("Vendor shortlist")).toBeInTheDocument();
    expect(within(linked).getByText("Task · links here")).toBeInTheDocument();
  });
});
