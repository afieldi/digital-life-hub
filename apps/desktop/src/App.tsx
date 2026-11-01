import { ApiClientProvider, OpenItemProvider } from "@dlh/client";
import { Scene } from "@dlh/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ChangesProvider } from "./api/ChangesProvider";
import type { SubscribeChanges } from "./api/changes";
import { type createApi, TRPCProvider } from "./api/client";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { SignIn } from "./auth/SignInScreen";
import type { SignInMethod } from "./auth/signIn";
import type { TokenStore } from "./auth/tokenStore";
import type { AppRouter } from "./router";

export type AuthSetup = {
  tokenStore: TokenStore;
  method: SignInMethod;
  api: ReturnType<typeof createApi>;
  sessionCheckMs?: number;
};

function Gate({
  router,
  method,
  subscribe,
}: {
  router: AppRouter;
  method: SignInMethod;
  subscribe: SubscribeChanges;
}) {
  const { status } = useAuth();
  if (status === "loading") return <Scene />;
  if (status === "signedIn") {
    return (
      <ChangesProvider subscribe={subscribe}>
        <RouterProvider router={router} />
      </ChangesProvider>
    );
  }
  return <SignIn method={method} />;
}

export function App({ router, auth }: { router: AppRouter; auth: AuthSetup }) {
  const { api } = auth;
  return (
    <QueryClientProvider client={api.queryClient}>
      <TRPCProvider trpcClient={api.trpcClient} queryClient={api.queryClient}>
        <AuthProvider
          tokenStore={auth.tokenStore}
          method={auth.method}
          api={api}
          sessionCheckMs={auth.sessionCheckMs}
        >
          <ApiClientProvider client={api.trpcClient}>
            <OpenItemProvider>
              <Gate
                router={router}
                method={auth.method}
                subscribe={api.subscribeChanges}
              />
            </OpenItemProvider>
          </ApiClientProvider>
        </AuthProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
