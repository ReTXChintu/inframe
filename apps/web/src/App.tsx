import { useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import { useAuth, type Status } from "@/lib/auth";
import { Logo, Spinner } from "@/components/ui";
import { AppShell } from "@/layouts/AppShell";
import { AuthLayout } from "@/layouts/AuthLayout";
import { LoginPage, SignupPage } from "@/pages/Auth";
import { ForgotPasswordPage, ResetPasswordPage } from "@/pages/PasswordReset";
import { EventsPage } from "@/pages/Events";
import { NewEventPage } from "@/pages/NewEvent";
import { EventPage } from "@/pages/Event";
import { UploadPage } from "@/pages/Upload";
import { EventSettingsPage } from "@/pages/EventSettings";
import { JoinCodePage, JoinPage } from "@/pages/Join";
import { InvitePage } from "@/pages/Invite";
import { MyPhotosPage } from "@/pages/MyPhotos";
import { PeoplePage } from "@/pages/People";
import { SettingsPage } from "@/pages/Settings";
import { NotFoundPage } from "@/pages/NotFound";
import { AdminPage } from "@/pages/Admin";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6">
      <Logo />
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "signed-out") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Only an in-app path is a valid post-login destination. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/**
 * Sign-in pages bounce people who arrive already signed in. Someone who signs
 * in *here* is redirected by the page itself (e.g. sign-up → selfie step), so
 * only the first settled status decides.
 */
function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const arrivedAs = useRef<Status | null>(null);
  if (status === "loading") return <Splash />;
  arrivedAs.current ??= status;
  if (arrivedAs.current === "signed-in") return <Navigate to={safeNext(params.get("next"))} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly><AuthLayout /></GuestOnly>}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      {/* Reachable signed in or out: the link comes from an email. */}
      <Route element={<AuthLayout />}>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<EventsPage />} />
        <Route path="/events/new" element={<NewEventPage />} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/events/:id/upload" element={<UploadPage />} />
        <Route path="/events/:id/settings" element={<EventSettingsPage />} />
        <Route path="/join" element={<JoinCodePage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/photos" element={<MyPhotosPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
