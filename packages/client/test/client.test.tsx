import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ApiClientProvider,
  OpenItemProvider,
  useModuleApi,
  useOpenItem,
  useRecordView,
} from "../src/index";

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

function openItemWrapper(client: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ApiClientProvider client={client}>
      <OpenItemProvider>{children}</OpenItemProvider>
    </ApiClientProvider>
  );
}

test("useRecordView sets the open item while mounted and clears it on unmount", () => {
  const mutate = vi.fn().mockResolvedValue(undefined);
  const { result, rerender, unmount } = renderHook(
    ({ id }) => {
      useRecordView(id);
      return useOpenItem();
    },
    {
      initialProps: { id: "a" as string | undefined },
      wrapper: openItemWrapper({ recents: { record: { mutate } } }),
    },
  );
  expect(result.current).toBe("a");
  rerender({ id: "b" });
  expect(result.current).toBe("b");
  rerender({ id: undefined });
  expect(result.current).toBeNull();
  unmount();
});

function Page({ id }: { id: string }) {
  useRecordView(id);
  return null;
}

function Open() {
  return <output>{useOpenItem() ?? "none"}</output>;
}

test("an item page unmounting leaves a newer page's open item in place", () => {
  const mutate = vi.fn().mockResolvedValue(undefined);
  const Wrapper = openItemWrapper({ recents: { record: { mutate } } });
  const view = (pages: string[]) => (
    <Wrapper>
      {pages.map((id) => (
        <Page key={id} id={id} />
      ))}
      <Open />
    </Wrapper>
  );
  const { rerender } = render(view(["a"]));
  expect(screen.getByRole("status").textContent).toBe("a");
  rerender(view(["a", "b"]));
  expect(screen.getByRole("status").textContent).toBe("b");
  rerender(view(["b"]));
  expect(screen.getByRole("status").textContent).toBe("b");
  rerender(view([]));
  expect(screen.getByRole("status").textContent).toBe("none");
});

test("useOpenItem is null without a provider", () => {
  const { result } = renderHook(() => useOpenItem());
  expect(result.current).toBeNull();
});
