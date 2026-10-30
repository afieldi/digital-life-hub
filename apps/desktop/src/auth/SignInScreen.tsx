import { Button, GlassPanel, Scene } from "@dlh/ui";
import { useAuth } from "./AuthProvider";
import { devSignIn, type SignInFailure, type SignInMethod } from "./signIn";

const MESSAGES: Record<SignInFailure, string> = {
  denied: "Sign-in was cancelled.",
  cancelled: "Sign-in was cancelled.",
  timeout: "Sign-in timed out. Try again.",
  forbidden: "That Google account isn't allowed to use this hub.",
  expired: "Sign-in expired — try again.",
  network: "Can't reach the server. Check your connection and try again.",
};

export function SignIn({ method }: { method: SignInMethod }) {
  const { status, error, signIn } = useAuth();
  const label =
    status === "signingIn"
      ? "Waiting for Google…"
      : method === devSignIn
        ? "Sign in (dev)"
        : "Sign in with Google";
  return (
    <>
      <Scene />
      <main className="flex min-h-screen items-center justify-center px-8">
        <GlassPanel
          level="dialog"
          className="flex w-full max-w-md flex-col gap-4 p-8"
        >
          <h1 className="font-serif text-[40px] leading-tight text-ink-primary">
            Digital Life Hub
          </h1>
          <p className="text-[15px] text-ink-tertiary">
            Sign in with your Google account to continue.
          </p>
          {error && (
            <p role="alert" className="text-sm text-ink-primary">
              {MESSAGES[error.reason]}
            </p>
          )}
          {/* Stays enabled while waiting: a second press restarts the attempt. */}
          <Button
            variant="solid"
            onPress={() => {
              void signIn();
            }}
          >
            {label}
          </Button>
        </GlassPanel>
      </main>
    </>
  );
}
