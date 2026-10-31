import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiClientProvider, useModuleApi, useRecordView } from "../src/index";

function wrapper(client: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ApiClientProvider client={client}>{children}</ApiClientProvider>
  );
}

test("useModuleApi returns the module's property of the provided client", () => {
  const sample = { hello: {} };
  const { result } = renderHook(() => useModuleApi("sample"), {
    wrapper: wrapper({ sample }),
  });
  expect(result.current).toBe(sample);
});

test("useRecordView records once per id across re-renders", () => {
  const mutate = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(({ id }) => useRecordView(id), {
    initialProps: { id: "x" as string | undefined },
    wrapper: wrapper({ recents: { record: { mutate } } }),
  });
  rerender({ id: "x" });
  rerender({ id: "x" });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({ id: "x" });
  rerender({ id: "y" });
  expect(mutate).toHaveBeenCalledTimes(2);
});

test("useRecordView does nothing without an id and swallows failures", async () => {
  const mutate = vi.fn().mockRejectedValue(new Error("offline"));
  const { rerender } = renderHook(({ id }) => useRecordView(id), {
    initialProps: { id: undefined as string | undefined },
    wrapper: wrapper({ recents: { record: { mutate } } }),
  });
  expect(mutate).not.toHaveBeenCalled();
  rerender({ id: "z" });
  await Promise.resolve();
  expect(mutate).toHaveBeenCalledTimes(1);
});
