import { createTestApi } from "@dlh/api/testing";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { devSignIn, SignInError, type SignInMethod } from "../src/auth/signIn";
import { memoryTokenStore, type TokenStore } from "../src/auth/tokenStore";
import { createAppRouter } from "../src/router";
import { signedInApp } from "./apiHarness";

function renderSignedOut(method: SignInMethod) {
  const api = createTestApi({ devAuth: true });
  const tokenStore = memoryTokenStore();
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: ["/"] }),
  );
  render(
    <App
      router={router}
      auth={{
        tokenStore,
        method,
        api: createApi({ fetch: api.fetch, getToken: tokenStore.get }),
      }}
    />,
  );
  return { api, tokenStore };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function expectSignedIn(tokenStore: TokenStore, token: string) {
  expect(
    await screen.findByRole("navigation", { name: "Primary" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  expect(await tokenStore.get()).toBe(token);
}

test("no stored token shows the sign-in screen, and dev sign-in reaches Home", async () => {
  const { api, tokenStore } = renderSignedOut(devSignIn);
  expect(
    await screen.findByRole("heading", { name: "Digital Life Hub" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Sign in with your Google account to continue."),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign in (dev)" }));
  expect(await screen.findByTestId("greeting")).toBeInTheDocument();
  const token = await tokenStore.get();
  expect(token).not.toBeNull();
  const me = await api.client(token ?? undefined).auth.me.query();
  expect(me.email).toBe("arek@example.com");
});

test("a stored valid token opens straight into the shell", async () => {
  const { renderApp, tokenStore, token } = await signedInApp("/");
  renderApp();
  await expectSignedIn(tokenStore, token);
  expect(await screen.findByTestId("greeting")).toBeInTheDocument();
});

test("revoked elsewhere → signed out on the next session check", async () => {
  const { api, renderApp, tokenStore, token } = await signedInApp("/");
  renderApp({ sessionCheckMs: 50 });
  await expectSignedIn(tokenStore, token);

  const { sessionId } = await api.client(token).auth.me.query();
  const other = await api.signIn();
  await api.client(other).devices.revoke.mutate({ id: sessionId });

  expect(
    await screen.findByRole("button", { name: /Sign in/ }),
  ).toBeInTheDocument();
  expect(await tokenStore.get()).toBeNull();
});

test("server unreachable at launch keeps the token and the shell", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.reject(new TypeError("Failed to fetch")),
  );
  const tokenStore = memoryTokenStore("t");
  const api = createApi({ fetch, getToken: tokenStore.get });
  render(
    <App
      router={createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))}
      auth={{ tokenStore, method: devSignIn, api }}
    />,
  );
  await expectSignedIn(tokenStore, "t");
  // The session check has run and failed on the network.
  await waitFor(() =>
    expect(
      api.queryClient
        .getQueryCache()
        .getAll()
        .some((q) => q.state.status === "error"),
    ).toBe(true),
  );
  expect(fetch).toHaveBeenCalled();
  await expectSignedIn(tokenStore, "t");
});

test("a denied Google attempt shows the message and can retry", async () => {
  const method = vi
    .fn<SignInMethod>()
    .mockRejectedValueOnce(new SignInError("denied"))
    .mockImplementation(devSignIn);
  const { tokenStore } = renderSignedOut(method);
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in with Google" }),
  );
  expect(await screen.findByText("Sign-in was cancelled.")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with Google" }),
  );
  expect(await screen.findByTestId("greeting")).toBeInTheDocument();
  expect(await tokenStore.get()).not.toBeNull();
});

test("FORBIDDEN from exchange shows the allowed-account message", async () => {
  renderSignedOut(() => Promise.reject(new SignInError("forbidden")));
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in with Google" }),
  );
  expect(
    await screen.findByText(
      "That Google account isn't allowed to use this hub.",
    ),
  ).toBeInTheDocument();
});

test.each([
  ["timeout", "Sign-in timed out. Try again."],
  ["expired", "Sign-in expired — try again."],
  ["network", "Can't reach the server. Check your connection and try again."],
] as const)("a %s failure shows its message", async (reason, copy) => {
  renderSignedOut(() => Promise.reject(new SignInError(reason)));
  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in with Google" }),
  );
  expect(await screen.findByText(copy)).toBeInTheDocument();
});

test("a second press restarts the attempt; the superseded cancel is ignored", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const method = vi
    .fn<SignInMethod>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { api, tokenStore } = renderSignedOut(method);

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign in with Google" }),
  );
  const waiting = await screen.findByRole("button", {
    name: "Waiting for Google…",
  });
  expect(waiting).toBeEnabled();
  await userEvent.click(waiting);
  expect(method).toHaveBeenCalledTimes(2);

  // The Rust side cancels the stale wait once the new attempt starts.
  first.reject(new SignInError("cancelled"));
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText("Sign-in was cancelled.")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Waiting for Google…" }),
  ).toBeEnabled();

  const { token } = await api.client().auth.devSignIn.mutate({
    device: { name: "Browser (dev)", platform: "web" },
  });
  second.resolve(token);
  await expectSignedIn(tokenStore, token);
});
