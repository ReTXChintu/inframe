import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { plural, PROVIDER_LABEL, timeAgo } from "@/lib/format";
import { errorMessage, useFeedback } from "@/components/feedback";
import { AndroidAppCard } from "@/components/AndroidApp";
import { connectGoogle, GoogleNotSetUp, MegaConnectModal, ProviderMark, useConnections } from "@/components/StoragePicker";
import { Button, Card, IconTile, Modal, Segmented, Spinner, TextField } from "@/components/ui";

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-24 p-5">
      <section id={id}>
        <h2 className="text-title-section">{title}</h2>
        {description && <p className="mt-1 text-body text-tx2">{description}</p>}
        <div className="mt-4">{children}</div>
      </section>
    </Card>
  );
}

export function SettingsPage() {
  const { me } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { toast } = useFeedback();
  const qc = useQueryClient();

  useEffect(() => {
    const st = params.get("storage");
    if (st) {
      if (st === "connected") toast("Google Drive connected.");
      else if (st === "no-refresh-token") toast("Google didn't grant offline access. Remove InFrame from your Google account's third-party access, then try again.", "error");
      else if (st !== "cancelled") toast("Couldn't connect Google Drive. Try again.", "error");
      setParams({}, { replace: true });
      qc.invalidateQueries({ queryKey: ["connections"] });
    }
  }, [params, setParams, toast, qc]);

  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title-page">Settings</h1>
      {me?.user.isAdmin && (
        <Link
          to="/admin"
          className="flex min-h-16 items-center gap-3 rounded-xl border border-ln bg-sf p-4 transition-colors duration-[120ms] hover:bg-sf2"
        >
          <IconTile tone="accent"><ShieldCheck /></IconTile>
          <span className="min-w-0 flex-1">
            <span className="block text-title-card">Admin settings</span>
            <span className="mt-0.5 block text-body-s text-tx3">Face model, Google Drive and email for the whole server.</span>
          </span>
          <ChevronRight className="size-[18px] text-tx2" />
        </Link>
      )}
      <AndroidAppCard />
      {/* Two columns on wide screens: profile and appearance left, storage and account right. */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <ProfileSection />
          <AppearanceSection />
        </div>
        <div className="flex flex-col gap-5">
          <StorageSection />
          <AccountSection />
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [name, setName] = useState(me?.user.name ?? "");
  useEffect(() => setName(me?.user.name ?? ""), [me?.user.name]);
  const save = useMutation({
    mutationFn: () => api("/api/me", { method: "PATCH", body: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast("Saved.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  return (
    <Section title="Profile">
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField className="flex-1" label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <TextField className="flex-1" label="Email" value={me?.user.email ?? ""} readOnly disabled hint="Your sign-in email." />
        <Button type="submit" disabled={!name.trim() || name === me?.user.name} loading={save.isPending} size="lg" className="sm:mt-6">
          Save
        </Button>
      </form>
    </Section>
  );
}

function StorageSection() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { data, isLoading } = useConnections();
  const [megaOpen, setMegaOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/storage/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["event"] });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  return (
    <Section id="storage" title="Storage accounts" description="Where your events keep their original photos. InFrame only touches the folders you pick for events.">
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-3">
          {(data?.connections ?? []).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ln bg-sf2 p-3.5">
              <ProviderMark provider={c.provider} className="size-7" />
              <div className="min-w-0 flex-1">
                <p className="text-title-card">{PROVIDER_LABEL[c.provider]}</p>
                <p className="num truncate text-body-s text-tx3">
                  {c.accountLabel} · {plural(c.eventCount, "event")} · added {timeAgo(c.createdAt)}
                </p>
                {c.status === "error" && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-body-s font-medium text-warn">
                    <AlertTriangle className="size-4" /> {c.lastError ?? "Needs reconnecting."}
                  </p>
                )}
              </div>
              {c.status === "error" &&
                (c.provider === "gdrive" ? (
                  <Button size="sm" onClick={() => connectGoogle("/settings").catch((err) => toast(errorMessage(err), "error"))}>
                    Reconnect
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setMegaOpen(true)}>
                    Update password
                  </Button>
                ))}
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Disconnect ${PROVIDER_LABEL[c.provider]}?`,
                    body: c.eventCount
                      ? `${plural(c.eventCount, "event uses", "events use")} this account. Their photos stay visible in InFrame, but syncing and uploads stop until a new folder is connected.`
                      : "InFrame forgets this account's access.",
                    confirmLabel: "Disconnect",
                    danger: true,
                  });
                  if (ok) remove.mutate(c.id);
                }}
              >
                Disconnect
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<ProviderMark provider="gdrive" className="size-4" />}
              disabled={!data?.googleEnabled}
              onClick={() => connectGoogle("/settings").catch((err) => toast(errorMessage(err), "error"))}
            >
              Connect Google Drive
            </Button>
            <Button variant="secondary" icon={<ProviderMark provider="mega" className="size-4" />} onClick={() => setMegaOpen(true)}>
              Connect MEGA
            </Button>
          </div>
          {!data?.googleEnabled && <GoogleNotSetUp />}
        </div>
      )}
      <MegaConnectModal open={megaOpen} onClose={() => setMegaOpen(false)} />
    </Section>
  );
}

const THEME_KEY = "inframe:theme";
type Theme = "system" | "light" | "dark";

export function applyStoredTheme() {
  let theme: Theme = "system";
  try {
    theme = (localStorage.getItem(THEME_KEY) as Theme) || "system";
  } catch {
    /* storage blocked */
  }
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(() => applyStoredTheme());
  return (
    <Section title="Appearance">
      <Segmented
        className="w-full sm:w-60"
        label="Theme"
        value={theme}
        onChange={(t) => {
          setTheme(t);
          try {
            localStorage.setItem(THEME_KEY, t);
          } catch {
            /* ignore */
          }
          applyStoredTheme();
        }}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
    </Section>
  );
}

function AccountSection() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const del = useMutation({
    mutationFn: () => api("/api/me", { method: "DELETE", body: { confirm: confirmText.trim() } }),
    onSuccess: async () => {
      await signOut();
      navigate("/login", { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? (err.fields.confirm ?? err.message) : errorMessage(err)),
  });
  return (
    <Section title="Account" description="You sign in with your account, the same one for InFrame, SpendLog and Trippin. Its password is managed there.">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => signOut().then(() => navigate("/login"))}>
          Sign out
        </Button>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        size="sm"
        footer={
          <Button variant="dangerFill" size="lg" disabled={confirmText.trim() !== "DELETE"} loading={del.isPending} onClick={() => del.mutate()}>
            Delete forever
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-l text-tx2">
            Your selfies, family members and storage connections are deleted, and events you own are removed for everyone. Photo
            files in your Drive/MEGA stay where they are. Your sign-in account itself stays, for SpendLog and Trippin.
          </p>
          <TextField
            label="Type DELETE to confirm"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            error={error}
          />
        </div>
      </Modal>
    </Section>
  );
}
