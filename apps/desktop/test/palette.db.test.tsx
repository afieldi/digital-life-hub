import { resolve } from "node:path";
import { freshTestDb } from "@dlh/db/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { signedInApp } from "./apiHarness";

// jsdom gives @dlh/db no file URL to find its migrations from; tests run from apps/desktop.
const MIGRATIONS = resolve(process.cwd(), "../../packages/db/drizzle");

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(opts: Parameters<typeof signedInApp>[1] = {}) {
  const t = await freshTestDb(MIGRATIONS);
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
