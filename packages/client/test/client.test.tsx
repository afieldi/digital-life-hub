import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ApiClientProvider,
  OpenItemProvider,
  ShellProvider,
  useCommandBar,
  useDetailPanels,
  useGoChordPending,
  useHomeWidgets,
  useItemHref,
  useItemsChanged,
  useItemType,
  useModuleApi,
  useOpenExternal,
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

test("useCommandBar, useItemHref, useItemType, useItemsChanged, useGoChordPending and useHomeWidgets use the shell's, and do nothing without one", () => {
  const openCommandBar = vi.fn();
  const widget = { id: "tasks.today", label: "Today", component: () => null };
  const itemsChanged = vi.fn();
  const itemHref = (item: { id: string; type: string }) =>
    item.type === "task" ? `/tasks/${item.id}` : undefined;
  const task = { label: "Task", glyph: "Check", color: "green" };
  const itemType = (type: string) => (type === "task" ? task : undefined);
  const { result } = renderHook(
    () => ({
      bar: useCommandBar(),
      href: useItemHref(),
      type: useItemType(),
      changed: useItemsChanged(),
      goPending: useGoChordPending(),
      widgets: useHomeWidgets(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ShellProvider
          value={{
            openCommandBar,
            itemHref,
            itemType,
            itemsChanged,
            openExternal: async () => {},
            goChordPending: () => true,
            homeWidgets: [widget],
            detailPanels: [],
          }}
        >
          {children}
        </ShellProvider>
      ),
    },
  );
  result.current.bar.open("Reschedule ");
  expect(openCommandBar).toHaveBeenCalledWith("Reschedule ");
  expect(result.current.href({ id: "1", type: "task" })).toBe("/tasks/1");
  expect(result.current.type("task")).toBe(task);
  result.current.changed();
  expect(itemsChanged).toHaveBeenCalledOnce();
  expect(result.current.goPending()).toBe(true);
  expect(result.current.widgets).toEqual([widget]);

  const bare = renderHook(() => ({
    bar: useCommandBar(),
    href: useItemHref(),
    type: useItemType(),
    changed: useItemsChanged(),
    goPending: useGoChordPending(),
    widgets: useHomeWidgets(),
  }));
  expect(() => bare.result.current.bar.open()).not.toThrow();
  expect(() => bare.result.current.changed()).not.toThrow();
  expect(bare.result.current.goPending()).toBe(false);
  expect(bare.result.current.href({ id: "1", type: "task" })).toBeUndefined();
  expect(bare.result.current.type("task")).toBeUndefined();
  expect(bare.result.current.widgets).toEqual([]);
});

test("useDetailPanels returns one type's panels in order", () => {
  const panel = (itemType: string, id: string, order?: number) => ({
    itemType,
    id,
    label: id,
    order,
    component: () => null,
  });
  const detailPanels = [
    panel("task", "late"),
    panel("note", "other"),
    panel("task", "second", 2),
    panel("task", "first", 1),
    panel("task", "later"),
  ];
  const { result } = renderHook(() => useDetailPanels("task"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ShellProvider
        value={{
          openCommandBar: () => {},
          itemHref: () => undefined,
          itemType: () => undefined,
          itemsChanged: () => {},
          openExternal: async () => {},
          goChordPending: () => false,
          homeWidgets: [],
          detailPanels,
        }}
      >
        {children}
      </ShellProvider>
    ),
  });
  expect(result.current.map((p) => p.id)).toEqual([
    "first",
    "second",
    "late",
    "later",
  ]);
  expect(renderHook(() => useDetailPanels("task")).result.current).toEqual([]);
});

test("useOpenExternal uses the shell's, and opens a new window without one", async () => {
  const openExternal = vi.fn(async () => {});
  const { result } = renderHook(() => useOpenExternal(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ShellProvider
        value={{
          openCommandBar: () => {},
          itemHref: () => undefined,
          itemType: () => undefined,
          itemsChanged: () => {},
          openExternal,
          goChordPending: () => false,
          homeWidgets: [],
          detailPanels: [],
        }}
      >
        {children}
      </ShellProvider>
    ),
  });
  await result.current("https://x.slack.com/archives/1");
  expect(openExternal).toHaveBeenCalledWith("https://x.slack.com/archives/1");

  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const bare = renderHook(() => useOpenExternal());
  await bare.result.current("https://example.com/a");
  expect(open).toHaveBeenCalledWith(
    "https://example.com/a",
    "_blank",
    "noopener",
  );
  open.mockRestore();
});
