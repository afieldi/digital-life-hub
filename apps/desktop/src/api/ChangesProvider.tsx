import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { SubscribeChanges } from "./changes";

/** tRPC query keys start with the procedure path, e.g. `["auth","me"]`. */
function isAuthOrDevicesKey(queryKey: readonly unknown[]): boolean {
  const path = queryKey[0];
  const root = Array.isArray(path) ? path[0] : undefined;
  return root === "auth" || root === "devices";
}

/**
 * Keeps on-screen data fresh from the API's `/changes` stream. Render it only
 * while signed in: it holds a connection open for as long as it is mounted.
 * Once the stream has opened, `<html data-changes="live">` says so (e2e tests
 * wait for it before writing from outside the app); a later drop doesn't clear
 * it, as the stream reconnects and refetches on its own.
 */
export function ChangesProvider({
  subscribe,
  children,
}: {
  subscribe: SubscribeChanges;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    const refresh = () =>
      void queryClient.invalidateQueries({
        predicate: (q) => !isAuthOrDevicesKey(q.queryKey),
      });
    const root = document.documentElement;
    const stop = subscribe({
      onIds: refresh,
      onReconnect: () => {
        root.dataset.changes = "live";
        refresh();
      },
      onUnauthorized: () => void signOutRef.current(),
    });
    return () => {
      stop();
      delete root.dataset.changes;
    };
  }, [subscribe, queryClient]);

  return children;
}
