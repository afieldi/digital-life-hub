import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { ChangesProvider } from "../src/api/ChangesProvider";
import type { SubscribeChanges } from "../src/api/changes";
import { AuthContext, type AuthState } from "../src/auth/AuthProvider";

const keys = {
  me: [["auth", "me"], { type: "query" }],
  devices: [["devices", "list"], { type: "query" }],
  item: [["items", "get"], { input: { id: "a" }, type: "query" }],
};

function setup() {
  const queryClient = new QueryClient();
  for (const key of Object.values(keys)) {
    queryClient.setQueryData(key, "v");
  }
  let handlers!: Parameters<SubscribeChanges>[0];
  const stop = vi.fn();
  const subscribe: SubscribeChanges = (h) => {
    handlers = h;
    return stop;
  };
  const signOut = vi.fn().mockResolvedValue(undefined);
  const auth = { signOut } as unknown as AuthState;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext value={auth}>
        <ChangesProvider subscribe={subscribe}>
          <p>child</p>
        </ChangesProvider>
      </AuthContext>
    </QueryClientProvider>,
  );
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false;
  return { handlers: () => handlers, stop, signOut, invalidated, view };
}

test("an ids event invalidates module queries but not auth or devices", async () => {
  const t = setup();
  t.handlers().onIds(["a"]);
  await waitFor(() => expect(t.invalidated(keys.item)).toBe(true));
  expect(t.invalidated(keys.me)).toBe(false);
  expect(t.invalidated(keys.devices)).toBe(false);
});

test("a reconnect invalidates the same set", async () => {
  const t = setup();
  t.handlers().onReconnect();
  await waitFor(() => expect(t.invalidated(keys.item)).toBe(true));
  expect(t.invalidated(keys.me)).toBe(false);
});

test("unauthorized signs out; unmount stops the stream", () => {
  const t = setup();
  t.handlers().onUnauthorized();
  expect(t.signOut).toHaveBeenCalledTimes(1);
  t.view.unmount();
  expect(t.stop).toHaveBeenCalledTimes(1);
});
