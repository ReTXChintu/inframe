import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { safeNext } from "@/App";
import { Button, PasswordField, TextField } from "@/components/ui";

function useNext() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const query = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return { next, query };
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">
      {message}
    </p>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { next, query } = useNext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-[15px] text-muted">Sign in to see your events and the photos you're in.</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email}
          required
          autoFocus
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
          required
        />
        <Link to="/forgot-password" className="-mt-1 self-end text-[13px] font-medium text-ink-2 underline-offset-4 hover:underline">
          Forgot password?
        </Link>
        <Button type="submit" size="lg" loading={busy} className="mt-2">
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-[15px] text-muted">
        New to InFrame?{" "}
        <Link to={`/signup${query}`} className="font-semibold text-ink underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const { next, query } = useNext();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setFields({ confirm: "The passwords don't match." });
      return;
    }
    setFields({});
    setBusy(true);
    try {
      await signUp(name, email, password);
      // New accounts go to People first to add a selfie, unless they came from an invite link.
      navigate(next !== "/" ? next : "/people?welcome=1", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(err instanceof Error ? err.message : "Couldn't create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-[15px] text-muted">Start a shared album, or join one with a code.</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <TextField
          label="Your name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
          required
          autoFocus
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fields.email}
          required
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
          hint="At least 8 characters, with a letter and a number."
          required
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fields.confirm}
          required
        />
        <Button type="submit" size="lg" loading={busy} className="mt-2">
          Create account
        </Button>
      </form>
      <p className="mt-8 text-[15px] text-muted">
        Already have an account?{" "}
        <Link to={`/login${query}`} className="font-semibold text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
