import { modulesShowing } from "@dlh/core";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useRegistry } from "../modules";
import type { SubscribeChanges } from "./changes";

/**
 * A query key's first segment: tRPC keys start with the procedure path
 * (`[["auth","me"], …]`), a module's own with its id (`["tasks", …]`).
 */
function rootOf(queryKey: readonly unknown[]): unknown {
  const first = queryKey[0];
  return Array.isArray(first) ? first[0] : first;
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

  const registry = useRegistry();

  useEffect(() => {
    const moduleIds = new Set(registry.modules.map((m) => m.id));
    /**
     * Refetches what's on screen, but not auth or devices. With `types`, a
     * module's queries refresh only when it shows one of them; Core's always.
     */
    const refresh = (types?: readonly string[]) => {
      const showing = types ? modulesShowing(registry, types) : null;
      void queryClient.invalidateQueries({
        predicate: (q) => {
          const key = rootOf(q.queryKey);
          if (key === "auth" || key === "devices") return false;
          if (!showing || typeof key !== "string" || !moduleIds.has(key)) {
            return true;
          }
          return showing.has(key);
        },
      });
    };
    const root = document.documentElement;
    const stop = subscribe({
      onIds: (_ids, types) => refresh(types),
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
  }, [subscribe, queryClient, registry]);

  return children;
}
