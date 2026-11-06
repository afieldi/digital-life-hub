import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { dismissToasts, freshApiDb, signedInApp } from "./apiHarness";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await dismissToasts();
  cleanup();
  await Promise.all(closers.splice(0).map((close) => close()));
});

test("Settings shows Slack, and saving writes the settings", async () => {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp("/settings", { db: t.db });
  app.renderApp();
  await screen.findByRole("heading", { name: "Slack" });
  const owner = await screen.findByRole("textbox", {
    name: "Your Slack user ID",
  });
  await userEvent.type(owner, "U123");
  await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(async () =>
    expect(
      await app.api.client(app.token).slack.settings.query({}),
    ).toMatchObject({
      ownerSlackId: "U123",
      interpreter: "typesafe-ai/jev",
    }),
  );
});

test("a blank Threshold is an error and is not saved", async () => {
  const t = await freshApiDb();
  closers.push(t.close);
  const app = await signedInApp("/settings", { db: t.db });
  app.renderApp();
  await screen.findByRole("heading", { name: "Slack" });
  const before = await app.api.client(app.token).slack.settings.query({});
  const threshold = await screen.findByRole("textbox", { name: "Threshold" });
  await userEvent.clear(threshold);
  await screen.findByText("Enter a number from 0 to 1.");
  await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
  // Give a wrongly sent save time to land.
  await new Promise((r) => setTimeout(r, 200));
  expect(
    (await app.api.client(app.token).slack.settings.query({})).threshold,
  ).toBe(before.threshold);
});
