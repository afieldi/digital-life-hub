import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type createApi, isUnauthorized, useTRPC } from "../api/client";
import { type SignInError, type SignInMethod, toSignInError } from "./signIn";
import type { TokenStore } from "./tokenStore";

export type AuthStatus = "loading" | "signedOut" | "signingIn" | "signedIn";

export type AuthState = {
  status: AuthStatus;
  error: SignInError | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}

export function AuthProvider({
  tokenStore,
  method,
  api,
  sessionCheckMs = 30_000,
  children,
}: {
  tokenStore: TokenStore;
  method: SignInMethod;
  api: ReturnType<typeof createApi>;
  sessionCheckMs?: number;
  children?: ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<SignInError | null>(null);
  // Each sign-in press starts a new attempt; only the latest may settle state.
  const attemptRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let live = true;
    tokenStore.get().then(
      (token) => {
        if (live) setStatus(token ? "signedIn" : "signedOut");
      },
      () => {
        if (live) setStatus("signedOut");
      },
    );
    return () => {
      live = false;
    };
  }, [tokenStore]);

  const clearLocal = useCallback(async () => {
    attemptRef.current++;
    await tokenStore.clear().catch(() => {});
    api.queryClient.clear();
    setStatus("signedOut");
  }, [tokenStore, api]);

  // Only the server saying UNAUTHORIZED ends the session; network and other
  // errors leave the stored token alone.
  useEffect(() => {
    const onError = (err: unknown) => {
      if (statusRef.current === "signedIn" && isUnauthorized(err)) {
        void clearLocal();
      }
    };
    const unsubQueries = api.queryClient.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") {
        onError(e.action.error);
      }
    });
    const unsubMutations = api.queryClient.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && e.action.type === "error") {
        onError(e.action.error);
      }
    });
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [api, clearLocal]);

  const trpc = useTRPC();
  useQuery({
    ...trpc.auth.me.queryOptions(),
    enabled: status === "signedIn",
    refetchInterval: sessionCheckMs,
    refetchOnWindowFocus: true,
    // The next interval is the retry.
    retry: false,
  });

  const signIn = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setError(null);
    setStatus("signingIn");
    try {
      const token = await method(api.trpcClient);
      if (attempt !== attemptRef.current) return;
      await tokenStore.set(token);
      if (attempt !== attemptRef.current) return;
      setStatus("signedIn");
    } catch (err) {
      // A superseded attempt (e.g. cancelled by a second press) says nothing.
      if (attempt !== attemptRef.current) return;
      setError(toSignInError(err));
      setStatus("signedOut");
    }
  }, [method, api, tokenStore]);

  const signOut = useCallback(async () => {
    try {
      await api.trpcClient.auth.signOut.mutate();
    } catch {
      // Signing out locally matters more than telling the server.
    }
    await clearLocal();
  }, [api, clearLocal]);

  const value = useMemo(
    () => ({ status, error, signIn, signOut }),
    [status, error, signIn, signOut],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}
