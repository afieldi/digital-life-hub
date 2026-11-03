import type { CoreRouter } from "@dlh/server";
import type { TRPCClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";

// The desktop owns the concrete tRPC client (its type includes the API's
// auth routers, which modules must not see), so it is provided untyped and
// narrowed by the hooks below.
const ClientContext = createContext<unknown>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client: unknown;
  children?: ReactNode;
}) {
  return <ClientContext value={client}>{children}</ClientContext>;
}

function useClient(): unknown {
  const client = useContext(ClientContext);
  if (!client) {
    throw new Error("useCoreApi/useModuleApi need an <ApiClientProvider>");
  }
  return client;
}

/** Typed access to the core routers (items, links, search, recents). */
export function useCoreApi(): TRPCClient<CoreRouter> {
  return useClient() as TRPCClient<CoreRouter>;
}

/** Typed access to one server module's router, mounted under its id. */
export function useModuleApi<R extends AnyRouter>(
  moduleId: string,
): TRPCClient<R> {
  // biome-ignore lint/suspicious/noExplicitAny: the client is provided untyped; the caller supplies the module's router type.
  return (useClient() as any)[moduleId] as TRPCClient<R>;
}

/** The id of the item whose page is on screen, or null (e.g. on Home). */
export const OpenItemContext = createContext<string | null>(null);

const SetOpenItemContext = createContext<
  Dispatch<SetStateAction<string | null>>
>(() => {});

/** Holds the open item; item pages set it through `useRecordView`. */
export function OpenItemProvider({ children }: { children?: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  return (
    <SetOpenItemContext value={setId}>
      <OpenItemContext value={id}>{children}</OpenItemContext>
    </SetOpenItemContext>
  );
}

/** The item on screen, as set by the mounted item page; null when none. */
export function useOpenItem(): string | null {
  return useContext(OpenItemContext);
}

/**
 * Records that the user viewed an item: once per id per mount. Recents are a
 * convenience, so a failure is ignored. While mounted, the item is also the
 * open item (`useOpenItem`).
 */
export function useRecordView(id: string | undefined): void {
  const client = useCoreApi();
  const setOpenItem = useContext(SetOpenItemContext);
  useEffect(() => {
    if (!id) return;
    client.recents.record.mutate({ id }).catch(() => {});
  }, [client, id]);
  useEffect(() => {
    if (!id) return;
    setOpenItem(id);
    // Only clear it if no other page has claimed it since.
    return () => setOpenItem((current) => (current === id ? null : current));
  }, [setOpenItem, id]);
}

/** What the desktop shell offers module screens. */
export type ShellApi = {
  /** Opens the command bar (⌘K), with `query` already typed when given. */
  openCommandBar: (query?: string) => void;
  /** An item's page, from its module's item type; undefined for unknown types. */
  itemHref: (item: { id: string; type: string }) => string | undefined;
  /**
   * A screen wrote items: the shell's own reads of them (⌘K's open item and
   * its version) refetch now, rather than when the change stream says so.
   */
  itemsChanged: () => void;
  /**
   * Opens a web link outside the app, in the system browser. Rejects when the
   * link can't be opened.
   */
  openExternal: (url: string) => Promise<void>;
  /**
   * Whether the key being handled follows `g`, so it is the shell's "go to"
   * chord rather than a screen's own shortcut.
   */
  goChordPending: () => boolean;
};

/** Outside a desktop shell (tests, the browser): a new window. */
async function openInNewWindow(url: string): Promise<void> {
  window.open(url, "_blank", "noopener");
}

const ShellContext = createContext<ShellApi>({
  openCommandBar: () => {},
  itemHref: () => undefined,
  itemsChanged: () => {},
  openExternal: openInNewWindow,
  goChordPending: () => false,
});

/** Given by the shell around every module screen. */
export function ShellProvider({
  value,
  children,
}: {
  value: ShellApi;
  children?: ReactNode;
}) {
  return <ShellContext value={value}>{children}</ShellContext>;
}

/** Opens ⌘K from a screen, e.g. a ⋯ menu's "Ask AI…". */
export function useCommandBar(): { open: (query?: string) => void } {
  const { openCommandBar } = useContext(ShellContext);
  return { open: openCommandBar };
}

/** Tells the shell a screen wrote items (see `ShellApi.itemsChanged`). */
export function useItemsChanged(): () => void {
  return useContext(ShellContext).itemsChanged;
}

/** Finds the page of an item of any module's type. */
export function useItemHref(): ShellApi["itemHref"] {
  return useContext(ShellContext).itemHref;
}

/** Opens a web link outside the app (see `ShellApi.openExternal`). */
export function useOpenExternal(): ShellApi["openExternal"] {
  return useContext(ShellContext).openExternal;
}

/** Whether the key being handled is part of a "go to" chord (see `ShellApi.goChordPending`). */
export function useGoChordPending(): ShellApi["goChordPending"] {
  return useContext(ShellContext).goChordPending;
}

export {
  isConflict,
  type ModuleWrite,
  type ModuleWriteOptions,
  UNDO_TOAST_MS,
  type UndoToken,
  undoOf,
  useModuleWrite,
} from "./moduleWrite";
