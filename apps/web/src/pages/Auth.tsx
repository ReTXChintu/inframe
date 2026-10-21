import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { LogIn } from "lucide-react";
import { safeNext } from "@/App";
import { Button } from "@/components/ui";

/** What `/login?error=…` means, after the identity server sent someone back without a session. */
const SIGN_IN_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was started in another tab. Try again.",
  email_unverified: "Verify your email address with your account first, then sign in again.",
  email_taken: "This email already belongs to a different InFrame account.",
  sso_not_configured: "Sign-in isn't set up on this server yet. Ask the person who runs it.",
  sso_unavailable: "The sign-in service can't be reached right now. Try again in a minute.",
};

/** Where the browser goes to sign in: the identity server, then back to `next`. */
export function signInUrl(next: string) {
  return `/api/auth/oidc/start${next !== "/" ? `?returnTo=${encodeURIComponent(next)}` : ""}`;
}

/** Old sign-up / forgot / reset links: there are no InFrame passwords any more, so they all lead to sign-in. */
export function ToLogin() {
  const [params] = useSearchParams();
  const next = params.get("next");
  return <Navigate to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} replace />;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const errorCode = params.get("error");
  const error = errorCode ? (SIGN_IN_ERRORS[errorCode] ?? "We couldn't sign you in. Try again.") : null;
  const [busy, setBusy] = useState(false);
  // Coming Back from the identity server restores this page from the back/forward cache, still "busy".
  useEffect(() => {
    const reset = () => setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold">Welcome to InFrame</h1>
      <p className="mt-2 text-[15px] text-muted">Sign in to see your events and the photos you're in.</p>
      <div className="mt-8 flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button
          size="lg"
          icon={<LogIn className="size-5" />}
          loading={busy}
          onClick={() => {
            setBusy(true);
            window.location.assign(signInUrl(next));
          }}
        >
          Sign in with your account
        </Button>
        <p className="text-[14px] text-muted">
          One account for InFrame, SpendLog and Trippin. New here? The same button creates your InFrame account.
        </p>
      </div>
    </div>
  );
}
