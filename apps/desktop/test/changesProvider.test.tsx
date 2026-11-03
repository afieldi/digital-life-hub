import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { ChangesProvider } from "../src/api/ChangesProvider";
import type { SubscribeChanges } from "../src/api/changes";
import { AuthContext, type AuthState } from "../src/auth/AuthProvider";

const keys = {
  me: [["auth", "me"], { type: "query" }],
  devices: [["devices", "list"], { type: "query" }],
  item: [["items", "get"], { input: { id: "a" }, type: "query" }],
  // The app's modules: Tasks owns `task`; Requests owns `request` and shows tasks.
  tasks: ["tasks", "list"],
  requests: ["requests", "open"],
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

test("the root says data-changes=live once the stream opens, until unmount", () => {
  const t = setup();
  const root = document.documentElement;
  expect(root.dataset.changes).toBeUndefined();
  t.handlers().onReconnect();
  expect(root.dataset.changes).toBe("live");
  t.view.unmount();
  expect(root.dataset.changes).toBeUndefined();
});

test("an event with types refreshes only the modules that show them, and Core's", async () => {
  const t = setup();
  t.handlers().onIds(["r"], ["request"]);
  await waitFor(() => expect(t.invalidated(keys.requests)).toBe(true));
  expect(t.invalidated(keys.item)).toBe(true);
  expect(t.invalidated(keys.tasks)).toBe(false);

  const u = setup();
  // Requests shows the task a request became (refreshOn), so a task change reaches it.
  u.handlers().onIds(["t"], ["task"]);
  await waitFor(() => expect(u.invalidated(keys.tasks)).toBe(true));
  expect(u.invalidated(keys.requests)).toBe(true);
});

test("a type no module owns refreshes everything", async () => {
  const t = setup();
  t.handlers().onIds(["x"], ["mystery"]);
  await waitFor(() => expect(t.invalidated(keys.tasks)).toBe(true));
  expect(t.invalidated(keys.requests)).toBe(true);
  expect(t.invalidated(keys.me)).toBe(false);
});
