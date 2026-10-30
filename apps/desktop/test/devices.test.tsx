import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signedInApp } from "./apiHarness";

async function row(name: string) {
  const title = await screen.findByText(name);
  return title.closest("div.relative") as HTMLElement;
}

test("lists both devices, marks this one, and revokes the other", async () => {
  const { api, renderApp } = await signedInApp("/settings");
  const pcToken = await api.signIn({ name: "Arek's PC", platform: "windows" });
  renderApp();
  expect(
    await screen.findByRole("heading", { name: "Devices" }),
  ).toBeInTheDocument();
  const pc = await row("Arek's PC");
  const here = await row("Browser (dev)");
  expect(within(pc).getByText(/^Windows · /)).toBeInTheDocument();
  expect(within(here).getByText(/^Browser · /)).toBeInTheDocument();
  expect(within(here).getByText("This device")).toBeInTheDocument();
  expect(within(here).queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(within(pc).queryByText("This device")).toBeNull();

  await userEvent.click(within(pc).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(screen.queryByText("Arek's PC")).toBeNull());
  expect(screen.getByText("Browser (dev)")).toBeInTheDocument();
  await expect(api.client(pcToken).auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
});

test("Sign out confirms, then shows the sign-in screen and clears the token", async () => {
  const { tokenStore, renderApp } = await signedInApp("/settings");
  renderApp();
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign out" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Sign out of this device?",
  });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Sign out" }),
  );
  expect(
    await screen.findByText("Sign in with your Google account to continue."),
  ).toBeInTheDocument();
  expect(await tokenStore.get()).toBeNull();
});

test("Cancel keeps you signed in", async () => {
  const { tokenStore, renderApp } = await signedInApp("/settings");
  renderApp();
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign out" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Sign out of this device?",
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("heading", { name: "Devices" })).toBeInTheDocument();
  expect(await tokenStore.get()).not.toBeNull();
});
