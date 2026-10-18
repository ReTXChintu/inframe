import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MailCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, PasswordField, TextField } from "@/components/ui";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot-password", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the email.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="animate-rise">
        <MailCheck className="mb-5 size-10 text-accent" aria-hidden />
        <h1 className="text-3xl font-semibold">Check your email</h1>
        <p className="mt-3 text-[15px] text-muted">
          If an account exists for <strong className="text-ink">{email}</strong>, we've sent a link to choose a new password. It
          works for one hour.
        </p>
        <Link to="/login" className="mt-8 inline-block font-semibold underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mt-2 text-[15px] text-muted">Enter your email and we'll send you a reset link.</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
            {error}
          </p>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <Button type="submit" size="lg" loading={busy}>
          Send reset link
        </Button>
      </form>
      <Link to="/login" className="mt-8 inline-block text-[15px] font-semibold underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { adoptToken } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setFields({ confirm: "The passwords don't match." });
    setFields({});
    setBusy(true);
    try {
      const res = await api<{ accessToken: string }>("/api/auth/reset-password", { body: { token, password } });
      await adoptToken(res.accessToken);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields.password) setFields(err.fields);
      else setError(err instanceof Error ? err.message : "Couldn't reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="text-3xl font-semibold">This link is incomplete</h1>
        <p className="mt-3 text-[15px] text-muted">Open the link from your email again, or ask for a new one.</p>
        <Link to="/forgot-password" className="mt-8 inline-block font-semibold underline-offset-4 hover:underline">
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <p className="mt-2 text-[15px] text-muted">You'll be signed out on your other devices.</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
            {error}{" "}
            <Link to="/forgot-password" className="font-semibold underline">
              Get a new link
            </Link>
          </p>
        )}
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
          hint="At least 8 characters, with a letter and a number."
          autoFocus
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fields.confirm}
        />
        <Button type="submit" size="lg" loading={busy}>
          Save password
        </Button>
      </form>
    </div>
  );
}
