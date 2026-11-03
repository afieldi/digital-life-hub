import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { createFixture, freshApiDb, signedInApp } from "./apiHarness";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(path: string, seedTitle = "Seeded fixture") {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp(path, { db: t.db, fixture: true });
  const item = await createFixture(app.fixture, { title: seedTitle });
  return { ...app, item };
}

test("lists seeded items and creates a new one", async () => {
  const { renderApp } = await setup("/fixture");
  const view = renderApp();
  expect(await screen.findByText("Seeded fixture")).toBeInTheDocument();
  await userEvent.type(
    screen.getByRole("textbox", { name: "New fixture item" }),
    "Brand new",
  );
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("Brand new")).toBeInTheDocument();
  view.unmount();
});

test("opening a row goes to the item and records a view", async () => {
  const { renderApp, router, api, token, item } = await setup("/fixture");
  const view = renderApp();
  await userEvent.click(
    await screen.findByRole("link", { name: "Seeded fixture" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Seeded fixture", level: 1 }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/fixture/${item.id}`);
  await waitFor(async () => {
    const recents = await api.client(token).recents.list.query();
    expect(JSON.stringify(recents)).toContain(item.id);
  });
  view.unmount();
});

async function openDetail() {
  const ctx = await setup("/");
  ctx.router.history.push(`/fixture/${ctx.item.id}`);
  const view = ctx.renderApp();
  await screen.findByRole("heading", { name: "Seeded fixture", level: 1 });
  return { ...ctx, view };
}

test("rename and save updates the heading", async () => {
  const { view } = await openDetail();
  const field = screen.getByRole("textbox", { name: "Title" });
  await userEvent.clear(field);
  await userEvent.type(field, "Renamed once");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("heading", { name: "Renamed once", level: 1 }),
  ).toBeInTheDocument();
  view.unmount();
});

test("a stale save reports the conflict and shows the server title", async () => {
  const { view, api, token, item } = await openDetail();
  const field = screen.getByRole("textbox", { name: "Title" });
  await userEvent.clear(field);
  await userEvent.type(field, "Mine");
  // Rename elsewhere before saving; the live refresh may or may not land first.
  await api.client(token).items.rename.mutate({
    id: item.id,
    expectedUpdatedAt: item.updatedAt,
    title: "Theirs",
  });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Changed elsewhere — reloaded"),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Theirs",
    ),
  );
  view.unmount();
});

test("a rename from another client appears without user action", async () => {
  const { view, api, token, item } = await openDetail();
  await api.client(token).items.rename.mutate({
    id: item.id,
    expectedUpdatedAt: item.updatedAt,
    title: "Remote title",
  });
  expect(
    await screen.findByRole("heading", { name: "Remote title", level: 1 }),
  ).toBeInTheDocument();
  view.unmount();
});

test("a draft does not follow the user to another item", async () => {
  const { view, fixture, router } = await openDetail();
  const other = await createFixture(fixture, { title: "Second fixture" });
  await userEvent.type(
    screen.getByRole("textbox", { name: "Title" }),
    " draft",
  );
  await router.navigate({ to: `/fixture/${other.id}` });
  await screen.findByRole("heading", { name: "Second fixture", level: 1 });
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Second fixture",
  );
  view.unmount();
});
