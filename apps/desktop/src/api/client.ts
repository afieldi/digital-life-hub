import type { AppRouter as ApiRouter } from "@dlh/api/router";
import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  type TRPCClient,
  TRPCClientError,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { type SubscribeChanges, subscribeChanges } from "./changes";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<ApiRouter>();

export const API_URL: string =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8787";

/** The server rejected the session token (missing, expired or revoked). */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.code === "UNAUTHORIZED";
}

export function createApi(opts: {
  url?: string;
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}): {
  trpcClient: TRPCClient<ApiRouter>;
  queryClient: QueryClient;
  /** `/changes` stream bound to the same url, fetch and token as tRPC. */
  subscribeChanges: SubscribeChanges;
} {
  const url = opts.url ?? API_URL;
  const trpcClient = createTRPCClient<ApiRouter>({
    links: [
      httpBatchLink({
        url: `${url}/trpc`,
        fetch: opts.fetch,
        headers: async () => {
          const token = await opts.getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying cannot fix a rejected session; let it sign out at once.
        retry: (failureCount, err) => !isUnauthorized(err) && failureCount < 3,
      },
    },
  });
  return {
    trpcClient,
    queryClient,
    subscribeChanges: (handlers) =>
      subscribeChanges({
        url: `${url}/changes`,
        getToken: opts.getToken,
        fetch: opts.fetch,
        ...handlers,
      }),
  };
}
