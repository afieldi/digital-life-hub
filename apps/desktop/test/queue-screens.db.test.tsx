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

async function setup(
  path: string,
  opts: Omit<NonNullable<Parameters<typeof signedInApp>[1]>, "db"> = {},
) {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp(path, { ...opts, db: t.db });
  return { ...app, db: t.db, client: app.api.client(app.token) };
}

type Client = Awaited<ReturnType<typeof setup>>["client"];

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

async function file(
  client: Client,
  input: Parameters<Client["requests"]["file"]["mutate"]>[0],
) {
  const { result } = await client.requests.file.mutate(input);
  return result.request;
}

const read = async (client: Client, id: string) =>
  (await client.requests.get.query({ id })).request;

/** The Queue rows on screen, in order. */
const rows = () => [
  ...document.querySelectorAll<HTMLElement>("[data-request-id]"),
];

const rowOf = async (title: string) => {
  const link = await screen.findByRole("link", { name: title });
  const row = link.closest<HTMLElement>("[data-request-id]");
  if (!row) throw new Error(`no row for ${title}`);
  return row;
};

/** The Detail panel, named by its request's title. */
const panel = (title: string) =>
  screen.findByRole("complementary", { name: title });

describe("Open", () => {
  test("Open lists requests oldest first with sender, age and preview", async () => {
    const { renderApp, client } = await setup("/queue");
    await file(client, {
      title: "Look at the renewal letter",
      body: "The deadline is on page 2.\nAnd the fee went up.",
      receivedAt: hoursAgo(3),
    });
    await file(client, {
      title: "Review the Q3 deck",
      body: "Mostly the hiring section.",
      fromName: "Maya Chen",
      source: "slack",
      sourceUrl: "https://example.slack.com/archives/C1/p1",
      externalId: "C1:1",
      receivedAt: hoursAgo(50),
    });
    renderApp();
    await screen.findByRole("link", { name: "Review the Q3 deck" });
    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(within(first as HTMLElement).getByText("Maya Chen")).toBeVisible();
    expect(first).toHaveTextContent("Review the Q3 deck");
    expect(first).toHaveTextContent("Mostly the hiring section.");
    expect(first).toHaveTextContent("2d");
    expect(second).toHaveTextContent("Look at the renewal letter");
    expect(within(second as HTMLElement).getByText("You")).toBeVisible();
    // One line of the body.
    expect(second).toHaveTextContent("The deadline is on page 2.");
    expect(second).not.toHaveTextContent("And the fee went up.");
    expect(second).toHaveTextContent("3h");
    const tabs = screen.getByRole("navigation", { name: "Queue views" });
    expect(within(tabs).getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("empty Open says Nothing waiting on you", async () => {
    const { renderApp } = await setup("/queue");
    renderApp();
    expect(
      await screen.findByText("Nothing waiting on you"),
    ).toBeInTheDocument();
  });

  test("empty Resolved says Nothing resolved yet", async () => {
    const { renderApp } = await setup("/queue/resolved");
    renderApp();
    expect(await screen.findByText("Nothing resolved yet")).toBeInTheDocument();
  });

  test("h on a focused row resolves it, and Undo puts it back", async () => {
    const { renderApp, client } = await setup("/queue");
    const request = await file(client, { title: "Approve the invoice" });
    renderApp();
    const link = await screen.findByRole("link", {
      name: "Approve the invoice",
    });
    // Keys act on the focused row only: h with nothing focused does nothing.
    await userEvent.keyboard("h");
    expect((await read(client, request.id)).outcome).toBeNull();
    link.focus();
    await userEvent.keyboard("h");
    await waitFor(() => expect(rows()).toHaveLength(0));
    await waitFor(async () =>
      expect((await read(client, request.id)).outcome).toBe("handled"),
    );
    expect(await screen.findByText("Handled")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByRole("link", { name: "Approve the invoice" });
    expect((await read(client, request.id)).outcome).toBeNull();
  });

  test("n on a focused row resolves it as not for me", async () => {
    const { renderApp, client } = await setup("/queue");
    const request = await file(client, { title: "Join the book club" });
    renderApp();
    (await screen.findByRole("link", { name: "Join the book club" })).focus();
    await userEvent.keyboard("n");
    await waitFor(async () =>
      expect((await read(client, request.id)).outcome).toBe("not_for_me"),
    );
  });

  test("Make task opens the form prefilled and creates a linked task", async () => {
    const { renderApp, client } = await setup("/queue");
    const request = await file(client, {
      title: "Can you call Maya back?",
      body: "About the venue.",
      fromName: "Sam",
    });
    renderApp();
    (
      await screen.findByRole("link", { name: "Can you call Maya back?" })
    ).focus();
    await userEvent.keyboard("t");
    const form = await screen.findByRole("dialog", { name: "Make task" });
    const title = within(form).getByRole("textbox", { name: "Title" });
    expect(title).toHaveValue("Can you call Maya back?");
    expect(within(form).getByRole("textbox", { name: "Notes" })).toHaveValue(
      "About the venue.",
    );
    await userEvent.clear(title);
    await userEvent.type(title, "Call Maya");
    await userEvent.click(within(form).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(rows()).toHaveLength(0));
    await screen.findByRole("button", { name: "Undo" });
    const { request: after, task } = await client.requests.get.query({
      id: request.id,
    });
    expect(after.outcome).toBe("task");
    expect(task).toMatchObject({ title: "Call Maya", deleted: false });
  });

  test("the Make task button opens the same form", async () => {
    const { renderApp, client } = await setup("/queue");
    await file(client, { title: "Plan the trip" });
    renderApp();
    const row = await rowOf("Plan the trip");
    await userEvent.click(
      within(row).getByRole("button", { name: "Make task: Plan the trip" }),
    );
    const form = await screen.findByRole("dialog", { name: "Make task" });
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Make task" })).toBeNull(),
    );
    expect(rows()).toHaveLength(1);
  });

  test("a request with actions shows them in place of the outcomes", async () => {
    const { renderApp, client, db } = await setup("/queue");
    const request = await file(client, { title: "Agent wants to send mail" });
    const actions = [
      {
        label: "Approve",
        operation: "requests.resolve",
        input: {
          id: request.id,
          expectedUpdatedAt: request.updatedAt,
          outcome: "handled",
        },
      },
    ];
    // `file` takes only actions whose operation calls `resolve`, which no
    // module has yet; write them straight to the row.
    await db.$client`update requests set actions = ${JSON.stringify(actions)}::jsonb
      where item_id = ${request.id}`;
    renderApp();
    const row = await rowOf("Agent wants to send mail");
    expect(within(row).queryByRole("button", { name: /^Handled/ })).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /^Not for me/ }),
    ).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /^Make task/ }),
    ).toBeNull();
    await userEvent.click(
      within(row).getByRole("button", {
        name: "Approve: Agent wants to send mail",
      }),
    );
    await waitFor(async () =>
      expect((await read(client, request.id)).outcome).toBe("handled"),
    );
    expect(
      await screen.findByRole("button", { name: "Undo" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(0));
  });

  test("a stale write toasts It changed elsewhere; try again and refetches", async () => {
    let elsewhere: (() => Promise<unknown>) | undefined;
    const app = await setup("/queue", {
      wrapFetch: (inner) => async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        // Someone renames the request just before the resolve reaches the server.
        if (url.includes("requests.resolve") && elsewhere) {
          const run = elsewhere;
          elsewhere = undefined;
          await run();
        }
        return inner(input, init);
      },
    });
    const request = await file(app.client, { title: "Old title" });
    elsewhere = () =>
      app.client.items.rename.mutate({
        id: request.id,
        expectedUpdatedAt: request.updatedAt,
        title: "New title",
      });
    app.renderApp();
    const row = await rowOf("Old title");
    await userEvent.click(
      within(row).getByRole("button", { name: "Handled: Old title" }),
    );
    expect(
      await screen.findByText("It changed elsewhere; try again"),
    ).toBeInTheDocument();
    // The refetch brings the row back with its new title, still open.
    await screen.findByRole("link", { name: "New title" });
    expect((await read(app.client, request.id)).outcome).toBeNull();
  });

  test("the nav count shows 2, then nothing after both are resolved", async () => {
    const { renderApp, client } = await setup("/queue");
    await file(client, { title: "First ask" });
    await file(client, { title: "Second ask" });
    renderApp();
    const dock = await screen.findByRole("navigation", { name: "Primary" });
    expect(
      await within(dock).findByRole("link", { name: "Queue 2" }),
    ).toBeInTheDocument();
    for (const title of ["First ask", "Second ask"]) {
      const row = await rowOf(title);
      await userEvent.click(
        within(row).getByRole("button", { name: `Handled: ${title}` }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("link", { name: title })).toBeNull(),
      );
    }
    expect(
      await within(dock).findByRole("link", { name: "Queue" }),
    ).toBeInTheDocument();
  });

  test("a load error shows Retry", async () => {
    let failing = true;
    const { renderApp, client } = await setup("/queue", {
      wrapFetch: (inner) => (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (failing && url.includes("requests.open")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return inner(input, init);
      },
    });
    await file(client, { title: "Back again" });
    renderApp();
    const retry = await screen.findByRole(
      "button",
      { name: "Retry" },
      { timeout: 15_000 },
    );
    expect(screen.getByText("Couldn't load the queue")).toBeInTheDocument();
    failing = false;
    await userEvent.click(retry);
    expect(
      await screen.findByRole("link", { name: "Back again" }),
    ).toBeInTheDocument();
  }, 20_000);
});

describe("Resolved", () => {
  test("Resolved filters by outcome chip and links a task outcome", async () => {
    const { renderApp, client, router } = await setup("/queue/resolved");
    const handled = await file(client, { title: "Handled one" });
    const ignored = await file(client, { title: "Ignored one" });
    const tasked = await file(client, { title: "Tasked one" });
    await client.requests.resolve.mutate({
      id: handled.id,
      expectedUpdatedAt: handled.updatedAt,
      outcome: "handled",
    });
    await client.requests.resolve.mutate({
      id: ignored.id,
      expectedUpdatedAt: ignored.updatedAt,
      outcome: "not_for_me",
    });
    const {
      result: { task },
    } = await client.requests.makeTask.mutate({
      id: tasked.id,
      expectedUpdatedAt: tasked.updatedAt,
      title: "Follow up",
    });
    renderApp();
    await screen.findByRole("link", { name: "Tasked one" });
    expect(rows()).toHaveLength(3);
    // The task outcome's chip links to the task.
    const taskRow = await rowOf("Tasked one");
    expect(
      within(taskRow).getByRole("link", { name: "Follow up" }),
    ).toHaveAttribute("href", `/tasks/${task.id}`);
    expect(
      within(await rowOf("Ignored one")).getByText("Not for me"),
    ).toBeInTheDocument();

    const filters = screen.getByRole("group", { name: "Filter by outcome" });
    await userEvent.click(
      within(filters).getByRole("link", { name: "Handled" }),
    );
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ outcome: "handled" }),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Handled one");
    await userEvent.click(
      within(
        screen.getByRole("group", { name: "Filter by outcome" }),
      ).getByRole("button", { name: "Remove filter: Handled" }),
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
  });
});

describe("Detail", () => {
  test("Detail shows the request in full, opens Slack, and Esc closes it", async () => {
    const { renderApp, client, router } = await setup("/queue");
    const request = await file(client, {
      title: "Review the Q3 deck",
      body: "Mostly the hiring section.\nBefore Thursday.",
      fromName: "Maya Chen",
      source: "slack",
      sourceUrl: "https://example.slack.com/archives/C1/p1",
      externalId: "C1:1",
    });
    renderApp();
    await userEvent.click(
      await screen.findByRole("link", { name: "Review the Q3 deck" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/queue/${request.id}`),
    );
    const p = await panel("Review the Q3 deck");
    expect(p).toHaveTextContent("Mostly the hiring section.");
    expect(p).toHaveTextContent("Before Thursday.");
    expect(within(p).getByText("Maya Chen")).toBeInTheDocument();
    expect(
      within(p).getByRole("button", { name: "Open in Slack" }),
    ).toBeInTheDocument();
    for (const name of ["Make task", "Handled", "Not for me"]) {
      expect(within(p).getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });

  test("Detail of a resolved request whose task was deleted says Task deleted, and Reopen works", async () => {
    const { renderApp, client, router } = await setup("/queue");
    const request = await file(client, { title: "Book the venue" });
    const {
      result: { task },
    } = await client.requests.makeTask.mutate({
      id: request.id,
      expectedUpdatedAt: request.updatedAt,
    });
    await client.items.delete.mutate({
      id: task.id,
      expectedUpdatedAt: task.updatedAt,
    });
    // Opened by URL, as ⌘K Jump to does.
    router.history.push(`/queue/${request.id}`);
    renderApp();
    const p = await panel("Book the venue");
    expect(within(p).getByText("Task deleted")).toBeInTheDocument();
    await userEvent.click(within(p).getByRole("button", { name: "Reopen" }));
    await waitFor(async () =>
      expect((await read(client, request.id)).outcome).toBeNull(),
    );
    expect(
      await within(p).findByRole("button", { name: "Handled" }),
    ).toBeInTheDocument();
    expect(within(p).queryByText("Task deleted")).toBeNull();
  });
});
