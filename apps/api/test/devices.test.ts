import { createTestApi } from "../src/testing";

const mac = { name: "Mac", platform: "macos" as const };
const pc = { name: "PC", platform: "windows" as const };

test("lists active sessions and marks the caller", async () => {
  const api = createTestApi();
  const macToken = await api.signIn(mac);
  await api.signIn(pc);
  const rows = await api.client(macToken).devices.list.query();
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.name === "Mac")?.current).toBe(true);
  expect(rows.find((r) => r.name === "PC")?.current).toBe(false);
  for (const r of rows) {
    expect(new Date(r.createdAt).toISOString()).toBe(r.createdAt);
    expect(new Date(r.lastUsedAt).toISOString()).toBe(r.lastUsedAt);
  }
});

test("revoking another device signs that device out on its next request", async () => {
  const api = createTestApi();
  const macToken = await api.signIn(mac);
  const pcToken = await api.signIn(pc);
  const rows = await api.client(macToken).devices.list.query();
  const pcRow = rows.find((r) => r.name === "PC");
  expect(
    await api.client(macToken).devices.revoke.mutate({ id: pcRow?.id ?? "" }),
  ).toEqual({ ok: true });
  await expect(api.client(pcToken).auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
  expect(await api.client(macToken).devices.list.query()).toHaveLength(1);
});

test("revoking an unknown or already-revoked id → NOT_FOUND", async () => {
  const api = createTestApi();
  const macToken = await api.signIn(mac);
  const pcToken = await api.signIn(pc);
  const client = api.client(macToken);
  await expect(
    client.devices.revoke.mutate({ id: crypto.randomUUID() }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  const pcRow = (await client.devices.list.query()).find(
    (r) => r.name === "PC",
  );
  await client.devices.revoke.mutate({ id: pcRow?.id ?? "" });
  await expect(
    client.devices.revoke.mutate({ id: pcRow?.id ?? "" }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  expect(pcToken).toBeTruthy();
});
