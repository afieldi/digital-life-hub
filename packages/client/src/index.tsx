import type { CoreRouter } from "@dlh/server";
import type { TRPCClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { createContext, type ReactNode, useContext, useEffect } from "react";

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

/**
 * Records that the user viewed an item: once per id per mount. Recents are a
 * convenience, so a failure is ignored.
 */
export function useRecordView(id: string | undefined): void {
  const client = useCoreApi();
  useEffect(() => {
    if (!id) return;
    client.recents.record.mutate({ id }).catch(() => {});
  }, [client, id]);
}
