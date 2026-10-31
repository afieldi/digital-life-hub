import { createTestApi } from "@dlh/api/testing";
import { subscribeChanges } from "../src/api/changes";

test("stop() releases the server-side stream of the in-process API", async () => {
  const api = createTestApi({ devAuth: true });
  const { token } = await api.client().auth.devSignIn.mutate({
    device: { name: "d", platform: "web" },
  });
  const stop = subscribeChanges({
    url: "http://api.test/changes",
    getToken: async () => token,
    fetch: api.fetch,
    onIds: () => {},
    onReconnect: () => {},
    onUnauthorized: () => {},
  });
  await vi.waitFor(() => expect(api.deps.changes.size()).toBe(1));
  stop();
  await vi.waitFor(() => expect(api.deps.changes.size()).toBe(0));
});
