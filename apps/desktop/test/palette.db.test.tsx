import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

async function setup(opts: Parameters<typeof signedInApp>[1] = {}) {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp("/", { ...opts, db: t.db });
  const sample = await app.api
    .client(app.token)
    .sample.create.mutate({ title: "Hello item" });
  return { ...app, sample };
}

async function openPalette() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Command bar" }),
  );
  return screen.findByRole("combobox");
}

const option = (name: string) =>
  screen.findByRole("option", { name: new RegExp(name) });

test("an empty query shows Recents and Go to", async () => {
  const { renderApp, api, token, sample } = await setup();
  await api.client(token).recents.record.mutate({ id: sample.id });
  renderApp();
  await openPalette();
  const recent = await screen.findByRole("group", { name: "Recents" });
  expect(within(recent).getByText("Hello item")).toBeInTheDocument();
  const goTo = screen.getByRole("group", { name: "Go to" });
  expect(within(goTo).getByText("Home")).toBeInTheDocument();
});

test("typing shows matching items under Jump to and matching actions", async () => {
  const { renderApp } = await setup();
  renderApp();
  const input = await openPalette();
  await userEvent.type(input, "hel");
  const jump = await screen.findByRole("group", { name: "Jump to" });
  expect(await within(jump).findByText("Hello item")).toBeInTheDocument();
  const actions = screen.getByRole("group", { name: "Actions" });
  expect(within(actions).getByText("Hello from Sample")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Recents" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Go to" })).toBeNull();
});

test("a typo still finds the item", async () => {
  const { renderApp } = await setup();
  renderApp();
  await userEvent.type(await openPalette(), "helo itm");
  expect(await option("Hello item")).toBeInTheDocument();
});

test("choosing a result navigates to the type's href", async () => {
  const { renderApp, router, sample } = await setup();
  renderApp();
  await userEvent.type(await openPalette(), "hello");
  await userEvent.click(await option("Hello item"));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/sample/${sample.id}`),
  );
});

test("only the latest query's results show when responses arrive out of order", async () => {
  let releaseH: (() => void) | undefined;
  const { renderApp, api, token } = await setup({
    wrapFetch: (inner) => (input, init) => {
      const url = decodeURIComponent(
        String(input instanceof Request ? input.url : input),
      );
      if (url.includes("/trpc/search") && url.includes('"query":"h"')) {
        return new Promise<Response>((resolve) => {
          releaseH = () => resolve(inner(input, init));
        });
      }
      return inner(input, init);
    },
  });
  await api.client(token).sample.create.mutate({ title: "Hat" });
  renderApp();
  const input = await openPalette();
  await userEvent.type(input, "h");
  await waitFor(() => expect(releaseH).toBeDefined());
  await userEvent.type(input, "ello");
  const jump = await screen.findByRole("group", { name: "Jump to" });
  expect(await within(jump).findByText("Hello item")).toBeInTheDocument();
  releaseH?.();
  await new Promise((r) => setTimeout(r, 100));
  expect(within(jump).getByText("Hello item")).toBeInTheDocument();
  expect(screen.queryByText("Hat")).toBeNull();
});

test("a failing search shows 'Search unavailable' and actions still show", async () => {
  const { renderApp } = await setup({
    wrapFetch: (inner) => (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/trpc/search")) {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      return inner(input, init);
    },
  });
  renderApp();
  await userEvent.type(await openPalette(), "hel");
  expect(await screen.findByText("Search unavailable")).toBeInTheDocument();
  expect(screen.getByText("Hello from Sample")).toBeInTheDocument();
});

/** Waits for the search for the typed text, so ↵ goes to the rows. */
const settled = () =>
  waitFor(() => {
    const jump = screen.getByRole("group", { name: "Jump to" });
    expect(
      within(jump).queryByText("No items match") ??
        within(jump).queryAllByRole("option")[0],
    ).toBeTruthy();
  });

test('"waiting on me" lists open requests with no AI', async () => {
  const { renderApp, api, token } = await setup({ noOpenRouter: true });
  const client = api.client(token);
  await client.requests.file.mutate({ title: "Review the Q3 deck" });
  const { result: done } = await client.requests.file.mutate({
    title: "Sign up for the offsite",
  });
  await client.requests.resolve.mutate({
    id: done.request.id,
    expectedUpdatedAt: done.request.updatedAt,
    outcome: "handled",
  });
  renderApp();
  await userEvent.type(await openPalette(), "waiting on me");
  const row = await screen.findByRole("option", { name: /^Waiting on me$/ });
  expect(row).toBe(screen.getAllByRole("option")[0]);
  await settled();
  await userEvent.keyboard("{Enter}");
  const heading = await screen.findByRole("heading", {
    name: "Waiting on you",
  });
  const result = heading.parentElement as HTMLElement;
  expect(
    await within(result).findByText("Review the Q3 deck"),
  ).toBeInTheDocument();
  expect(within(result).queryByText("Sign up for the offsite")).toBeNull();
  expect(screen.queryByText("Understood as")).toBeNull();
});

test('"File a request" opens its form and files with source manual', async () => {
  const { renderApp, api, token } = await setup();
  renderApp();
  await userEvent.type(await openPalette(), "File a request");
  await screen.findByRole("option", { name: /^File a request/ });
  await settled();
  await userEvent.keyboard("{Enter}");
  const form = await screen.findByRole("dialog", { name: "File a request" });
  await userEvent.type(
    within(form).getByRole("textbox", { name: "Title" }),
    "Look at the contract",
  );
  await userEvent.click(within(form).getByRole("button", { name: "Run" }));
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
  const client = api.client(token);
  const { items } = await client.requests.open.query({});
  const filed = items.find((i) => i.title === "Look at the contract");
  if (!filed) throw new Error("not filed");
  const { request } = await client.requests.get.query({ id: filed.id });
  expect(request.source).toBe("manual");
});

test('"not for me" on a request prefills the outcome', async () => {
  const { renderApp, router, api, token } = await setup();
  const client = api.client(token);
  const { result } = await client.requests.file.mutate({
    title: "Sign up for the offsite",
  });
  const id = result.request.id;
  // No Queue screens yet: any item page makes the request the open item.
  router.history.push(`/sample/${id}`);
  renderApp();
  await screen.findAllByRole("heading", { name: "Sign up for the offsite" });
  await userEvent.type(await openPalette(), "not for me");
  // The outcome came from the word ⌘K matched, so the row is ready.
  await screen.findByRole("option", { name: /^Not for me$/ });
  await settled();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("button", { name: "Undo" }),
  ).toBeInTheDocument();
  const { request } = await client.requests.get.query({ id });
  expect(request.outcome).toBe("not_for_me");
});
