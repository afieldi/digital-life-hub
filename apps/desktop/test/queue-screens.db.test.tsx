import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { registry } from "../src/modules";
import type { AppRouter } from "../src/router";
import { Shell } from "../src/shell/Shell";
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

  test("after h the next row has focus, so h again resolves it too", async () => {
    const { renderApp, client } = await setup("/queue");
    for (const [title, h] of [
      ["First", 3],
      ["Second", 2],
      ["Third", 1],
    ] as const) {
      await file(client, { title, receivedAt: hoursAgo(h) });
    }
    renderApp();
    (await screen.findByRole("link", { name: "First" })).focus();
    await userEvent.keyboard("h");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole("link", { name: "Second" })).toHaveFocus();
    await userEvent.keyboard("h");
    await waitFor(() => expect(rows()).toHaveLength(1));
    // The last row left: focus goes to the one before it.
    const third = screen.getByRole("link", { name: "Third" });
    expect(third).toHaveFocus();
    await userEvent.keyboard("n");
    await waitFor(() => expect(rows()).toHaveLength(0));
    // None left: the list itself, not the page body.
    expect(screen.getByRole("region", { name: "Open requests" })).toHaveFocus();
  });

  test("after Make task from the keyboard the next row has focus", async () => {
    const { renderApp, client } = await setup("/queue");
    await file(client, { title: "Older", receivedAt: hoursAgo(2) });
    await file(client, { title: "Newer", receivedAt: hoursAgo(1) });
    renderApp();
    (await screen.findByRole("link", { name: "Older" })).focus();
    await userEvent.keyboard("t");
    const form = await screen.findByRole("dialog", { name: "Make task" });
    await userEvent.click(within(form).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Newer" })).toHaveFocus(),
    );
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

  test("g then h on a focused row goes Home and leaves the request open", async () => {
    const { renderApp, router, client } = await setup("/queue");
    const request = await file(client, { title: "Join the book club" });
    renderApp();
    (await screen.findByRole("link", { name: "Join the book club" })).focus();
    await userEvent.keyboard("gh");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect((await read(client, request.id)).outcome).toBeNull();
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

  test("clearing Notes in Make task makes a task with no notes", async () => {
    const { renderApp, client, db } = await setup("/queue");
    const request = await file(client, {
      title: "Send the contract",
      body: "To legal.",
    });
    renderApp();
    (await screen.findByRole("link", { name: "Send the contract" })).focus();
    await userEvent.keyboard("t");
    const form = await screen.findByRole("dialog", { name: "Make task" });
    await userEvent.clear(within(form).getByRole("textbox", { name: "Notes" }));
    await userEvent.click(within(form).getByRole("button", { name: "Run" }));
    await screen.findByRole("button", { name: "Undo" });
    const { task } = await client.requests.get.query({ id: request.id });
    if (!task) throw new Error("no task");
    const [row] = await db.$client<{ notes: string | null }[]>`
      select notes from tasks where item_id = ${task.id}`;
    expect(row).toEqual({ notes: null });
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
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.click(
      within(p).getByRole("button", { name: "Open in Slack" }),
    );
    // Through the shell's openExternal: a new window outside the desktop app.
    expect(open).toHaveBeenCalledWith(
      "https://example.slack.com/archives/C1/p1",
      "_blank",
      "noopener",
    );
    open.mockRestore();
    for (const name of ["Make task", "Handled", "Not for me"]) {
      expect(within(p).getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });

  test("a link that won't open toasts Couldn't open the link", async () => {
    const { renderApp, client, router } = await setup("/queue");
    const request = await file(client, {
      title: "Read the doc",
      source: "ai",
      sourceUrl: "https://docs.example.com/d/1",
    });
    router.history.push(`/queue/${request.id}`);
    renderApp();
    const p = await panel("Read the doc");
    const open = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    await userEvent.click(
      within(p).getByRole("button", { name: "Open original" }),
    );
    expect(
      await screen.findByText("Couldn't open the link"),
    ).toBeInTheDocument();
    open.mockRestore();
  });

  test("Detail offers no link for a source URL that isn't http or https", async () => {
    const { renderApp, client, router, db } = await setup("/queue");
    const request = await file(client, { title: "Odd link", source: "ai" });
    // `file` refuses it now; a row written before that could still hold one.
    await db.$client`update requests set source_url = 'javascript:alert(1)'
      where item_id = ${request.id}`;
    router.history.push(`/queue/${request.id}`);
    renderApp();
    const p = await panel("Odd link");
    expect(within(p).getByRole("button", { name: "Handled" })).toBeVisible();
    expect(
      within(p).queryByRole("button", { name: "Open original" }),
    ).toBeNull();
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

describe("Needs you", () => {
  /** The widget as the manifest declares it, alone in the shell, as Home will place it. */
  const widgetRouter = (history: RouterHistory) => {
    const widget = registry.modules
      .find((m) => m.id === "requests")
      ?.homeWidgets?.find((w) => w.id === "needsYou");
    if (!widget) throw new Error("requests declares no needsYou widget");
    const Widget = widget.component;
    const root = createRootRoute({ component: Shell });
    return createRouter({
      history,
      routeTree: root.addChildren([
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => <Widget />,
        }),
      ]),
    }) as unknown as AppRouter;
  };

  test("NeedsYou shows the count and the three oldest", async () => {
    const { renderApp, client } = await setup("/", {
      createRouter: widgetRouter,
    });
    for (const [title, h] of [
      ["Ask D", 1],
      ["Ask C", 20],
      ["Ask A", 40],
      ["Ask B", 30],
    ] as const) {
      await file(client, { title, receivedAt: hoursAgo(h) });
    }
    renderApp();
    const widget = await screen.findByRole("region", { name: "Needs you" });
    expect(await within(widget).findByText("4 open")).toBeVisible();
    expect(
      within(widget)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Ask A", "Ask B", "Ask C"]);

    await userEvent.click(
      within(widget).getByRole("button", { name: "Handled: Ask A" }),
    );
    // The next oldest takes its place.
    await within(widget).findByRole("link", { name: "Ask D" });
    expect(within(widget).getByText("3 open")).toBeVisible();
    expect(within(widget).queryByRole("link", { name: "Ask A" })).toBeNull();
  });

  test("NeedsYou shows nothing at 0 open", async () => {
    const { renderApp, client } = await setup("/", {
      createRouter: widgetRouter,
    });
    const only = await file(client, { title: "Only ask" });
    await client.requests.resolve.mutate({
      id: only.id,
      expectedUpdatedAt: only.updatedAt,
      outcome: "handled",
    });
    renderApp();
    await screen.findByRole("navigation", { name: "Primary" });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(screen.queryByText(/ open$/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Only ask" })).toBeNull();
  });
});
