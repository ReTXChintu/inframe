import { copyText } from "@/lib/clipboard";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, Mail, ScanFace, ShieldCheck, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AdminSettings, SettingKey } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { ProviderMark } from "@/components/StoragePicker";
import { Badge, Button, Card, PasswordField, Spinner, TextField, Toggle } from "@/components/ui";

type Draft = Partial<Record<SettingKey, string | boolean>>;
type TestResult = { ok: true; detail: string } | { ok: false; detail: string } | null;

const SECTIONS: Record<"google" | "smtp" | "model", SettingKey[]> = {
  google: ["google.clientId", "google.clientSecret"],
  smtp: ["smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.pass", "smtp.from"],
  model: ["model.url", "model.apiKey", "model.apiKeyHeader", "model.timeoutMs", "model.matchThreshold"],
};
const SECRETS = new Set<SettingKey>(["google.clientSecret", "smtp.pass", "model.apiKey"]);
const NUMBERS = new Set<SettingKey>(["smtp.port", "model.timeoutMs", "model.matchThreshold"]);

/** Super-admin only: server-wide integrations, editable without touching .env. */
export function AdminPage() {
  const { me } = useAuth();
  if (me && !me.user.isAdmin) return <Navigate to="/" replace />;
  return <AdminContent />;
}

function AdminContent() {
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<AdminSettings>("/api/admin/settings") });
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api<{ counts: Record<string, number> }>("/api/admin/overview").then((r) => r.counts),
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.14em] text-accent uppercase">
          <ShieldCheck className="size-4" /> Super admin
        </p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Admin</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Server-wide settings. Changes apply immediately. Values you save here override the server's .env file.
        </p>
      </div>

      {overview.data && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(
            [
              ["users", "Users"],
              ["events", "Events"],
              ["photos", "Photos"],
              ["faces", "Faces"],
              ["connections", "Storage links"],
              ["failed", "Failed"],
            ] as const
          ).map(([k, label]) => (
            <Card key={k} className="px-3 py-3">
              <p className={`font-display text-2xl font-semibold tabular-nums ${k === "failed" && overview.data[k] ? "text-danger" : ""}`}>
                {overview.data[k]?.toLocaleString() ?? "—"}
              </p>
              <p className="text-[12px] text-muted">{label}</p>
            </Card>
          ))}
        </div>
      )}

      {settings.isLoading || !settings.data ? (
        <Spinner />
      ) : (
        // Wide screens: face model on the left, Google + email stacked on the right.
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <ModelSection data={settings.data} />
          <div className="flex flex-col gap-5">
            <GoogleSection data={settings.data} />
            <SmtpSection data={settings.data} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared form logic ───────────────────────────────────────────────────
function initialDraft(data: AdminSettings, keys: SettingKey[]): Draft {
  const d: Draft = {};
  for (const k of keys) {
    const s = data.settings[k];
    if (SECRETS.has(k)) d[k] = "";
    else if (typeof s.value === "boolean") d[k] = s.value;
    else d[k] = s.value === null || s.value === undefined ? "" : String(s.value);
  }
  return d;
}

/** Only fields that changed; secrets only when something was typed. */
function changes(data: AdminSettings, keys: SettingKey[], draft: Draft) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = draft[k];
    if (SECRETS.has(k)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
      continue;
    }
    const current = data.settings[k].value;
    if (typeof v === "boolean") {
      if (v !== current) out[k] = v;
    } else if ((v ?? "") !== (current === null || current === undefined ? "" : String(current))) {
      out[k] = v === "" ? "" : NUMBERS.has(k) ? Number(v) : v;
    }
  }
  return out;
}

function useSection(data: AdminSettings, keys: SettingKey[]) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(data, keys));
  const [fields, setFields] = useState<Record<string, string>>({});
  // Refill from the server when *this* section's saved values change (saving
  // another card mustn't wipe unsaved edits here).
  const signature = JSON.stringify(keys.map((k) => data.settings[k]));
  useEffect(() => setDraft(initialDraft(data, keys)), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = changes(data, keys, draft);
  const dirty = Object.keys(pending).length > 0;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<AdminSettings>("/api/admin/settings", { method: "PUT", body }),
    onSuccess: (next) => {
      qc.setQueryData(["admin-settings"], next);
      qc.invalidateQueries({ queryKey: ["connections"] });
      setFields({});
      toast("Settings saved.");
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else toast(errorMessage(err), "error");
    },
  });

  const set = (k: SettingKey, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: SettingKey) => (typeof draft[k] === "string" ? (draft[k] as string) : "");
  /** Remove every saved override in this section (falls back to .env / defaults). */
  const resetBody = Object.fromEntries(keys.filter((k) => data.settings[k].source === "admin").map((k) => [k, null]));

  return { draft, set, text, fields, pending, dirty, save, resetBody };
}

function SourceBadge({ source, set }: { source: string; set: boolean }) {
  if (!set) return null;
  if (source === "admin") return <Badge tone="ok">Saved here</Badge>;
  if (source === "env") return <Badge>From .env</Badge>;
  return <Badge>Default</Badge>;
}

function SectionCard({
  icon,
  title,
  description,
  status,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            {status}
          </div>
          <p className="mt-1 text-[14px] text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Actions({
  section,
  onTest,
  testLabel,
  testing,
  result,
}: {
  section: ReturnType<typeof useSection>;
  onTest?: () => void;
  testLabel?: string;
  testing?: boolean;
  result?: TestResult;
}) {
  const { confirm } = useFeedback();
  const canReset = Object.keys(section.resetBody).length > 0;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {result && (
        <p role="status" className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[14px] ${result.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
          {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span className="break-words">{result.detail}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (await confirm({ title: "Remove the values saved here?", body: "The server's .env values (or defaults) will be used instead.", confirmLabel: "Remove", danger: true })) {
                section.save.mutate(section.resetBody);
              }
            }}
          >
            Use .env values
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {onTest && (
            <Button variant="secondary" onClick={onTest} loading={testing}>
              {testLabel}
            </Button>
          )}
          <Button type="submit" disabled={!section.dirty} loading={section.save.isPending}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

const secretHint = (s: { set: boolean; source: string }) =>
  s.set ? `A value is saved${s.source === "env" ? " in .env" : ""}. Leave blank to keep it.` : undefined;

// ─── Face model ──────────────────────────────────────────────────────────
function ModelSection({ data }: { data: AdminSettings }) {
  const section = useSection(data, SECTIONS.model);
  const { text, set, fields } = section;
  const [result, setResult] = useState<TestResult>(null);
  const s = data.settings;
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: true; ms: number; faces: number } | { ok: false; error: string }>("/api/admin/settings/test-model", { body: section.pending }),
    onSuccess: (r) =>
      setResult(r.ok ? { ok: true, detail: `The model answered in ${r.ms} ms with the expected format.` } : { ok: false, detail: r.error }),
    onError: (err) => setResult({ ok: false, detail: errorMessage(err) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    section.save.mutate(section.pending);
  };
  const threshold = Number(text("model.matchThreshold") || 0.5);

  return (
    <SectionCard
      icon={<ScanFace className="size-6" />}
      title="Face model"
      description={
        <>
          InFrame sends images to <code className="rounded bg-surface-2 px-1">POST {"{URL}"}/extract</code> and expects 512-number face
          embeddings back.
        </>
      }
      status={s["model.url"].set ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not set up</Badge>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <TextField
          label="Model URL"
          placeholder="https://faces.example.com"
          value={text("model.url")}
          onChange={(e) => set("model.url", e.target.value)}
          error={fields["model.url"]}
          hint={<SourceBadge source={s["model.url"].source} set={s["model.url"].set} />}
          inputMode="url"
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <PasswordField
            label="API key (optional)"
            autoComplete="off"
            placeholder={s["model.apiKey"].set ? "Saved — type to replace" : "None"}
            value={text("model.apiKey")}
            onChange={(e) => set("model.apiKey", e.target.value)}
            error={fields["model.apiKey"]}
            hint={secretHint(s["model.apiKey"])}
          />
          <TextField
            label="Sent in header"
            value={text("model.apiKeyHeader")}
            onChange={(e) => set("model.apiKeyHeader", e.target.value)}
            error={fields["model.apiKeyHeader"]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Timeout (ms)"
            type="number"
            min={1000}
            step={1000}
            value={text("model.timeoutMs")}
            onChange={(e) => set("model.timeoutMs", e.target.value)}
            error={fields["model.timeoutMs"]}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="threshold" className="text-[13px] font-medium text-ink-2">
              Match strictness · <span className="tabular-nums">{threshold.toFixed(2)}</span>
            </label>
            <input
              id="threshold"
              type="range"
              min={0.3}
              max={0.8}
              step={0.01}
              value={threshold}
              onChange={(e) => set("model.matchThreshold", e.target.value)}
              className="h-11 accent-[var(--accent)]"
            />
            <p className="text-[13px] text-muted">
              Higher = fewer wrong matches, but more missed photos. 0.50 suits most models.
              {fields["model.matchThreshold"] && <span className="block text-danger">{fields["model.matchThreshold"]}</span>}
            </p>
          </div>
        </div>
        <Actions section={section} onTest={() => { setResult(null); test.mutate(); }} testLabel="Test connection" testing={test.isPending} result={result} />
      </form>
    </SectionCard>
  );
}

// ─── Google Drive ────────────────────────────────────────────────────────
function GoogleSection({ data }: { data: AdminSettings }) {
  const section = useSection(data, SECTIONS.google);
  const { text, set, fields } = section;
  const [copied, setCopied] = useState(false);
  const s = data.settings;
  const enabled = s["google.clientId"].set && s["google.clientSecret"].set;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    section.save.mutate(section.pending);
  };
  return (
    <SectionCard
      icon={<ProviderMark provider="gdrive" className="size-6" />}
      title="Google Drive"
      description="Lets event owners connect their Google Drive for storage. It's not used for signing in."
      status={enabled ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not set up</Badge>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <ol className="list-decimal space-y-1 rounded-2xl bg-surface-2 py-3 pr-4 pl-9 text-[14px] text-ink-2">
          <li>Google Cloud console → enable the <strong>Google Drive API</strong>.</li>
          <li>Set up the OAuth consent screen (in Testing, add your Google accounts as test users).</li>
          <li>
            Credentials → <strong>OAuth client ID</strong> → Web application, with this redirect URI:
          </li>
        </ol>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1 pl-3">
          <code className="min-w-0 flex-1 truncate text-[13px]">{data.googleRedirectUri}</code>
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            onClick={() =>
              copyText(data.googleRedirectUri).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <TextField
          label="Client ID"
          placeholder="1234-abc.apps.googleusercontent.com"
          value={text("google.clientId")}
          onChange={(e) => set("google.clientId", e.target.value)}
          error={fields["google.clientId"]}
          hint={<SourceBadge source={s["google.clientId"].source} set={s["google.clientId"].set} />}
          autoComplete="off"
        />
        <PasswordField
          label="Client secret"
          autoComplete="off"
          placeholder={s["google.clientSecret"].set ? "Saved — type to replace" : ""}
          value={text("google.clientSecret")}
          onChange={(e) => set("google.clientSecret", e.target.value)}
          error={fields["google.clientSecret"]}
          hint={secretHint(s["google.clientSecret"])}
        />
        <Actions section={section} />
      </form>
    </SectionCard>
  );
}

// ─── SMTP ────────────────────────────────────────────────────────────────
function SmtpSection({ data }: { data: AdminSettings }) {
  const { me } = useAuth();
  const section = useSection(data, SECTIONS.smtp);
  const { text, set, fields, draft } = section;
  const [result, setResult] = useState<TestResult>(null);
  const s = data.settings;
  const test = useMutation({
    mutationFn: () => api<{ ok: true; to: string } | { ok: false; error: string }>("/api/admin/settings/test-email", { body: section.pending }),
    onSuccess: (r) => setResult(r.ok ? { ok: true, detail: `Test email sent to ${r.to}. Check the inbox (and spam).` } : { ok: false, detail: r.error }),
    onError: (err) => setResult({ ok: false, detail: errorMessage(err) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    section.save.mutate(section.pending);
  };
  return (
    <SectionCard
      icon={<Mail className="size-6" />}
      title="Email (SMTP)"
      description="Used for password resets and event invites. While it's not set up, emails are written to the server log instead."
      status={s["smtp.host"].set ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not set up</Badge>}
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <TextField
            label="SMTP host"
            placeholder="smtp.gmail.com"
            value={text("smtp.host")}
            onChange={(e) => set("smtp.host", e.target.value)}
            error={fields["smtp.host"]}
            hint={<SourceBadge source={s["smtp.host"].source} set={s["smtp.host"].set} />}
            autoComplete="off"
          />
          <TextField label="Port" type="number" value={text("smtp.port")} onChange={(e) => set("smtp.port", e.target.value)} error={fields["smtp.port"]} />
        </div>
        <Toggle
          label="Use TLS from the start (port 465)"
          description="Leave off for port 587, which upgrades to TLS automatically."
          checked={draft["smtp.secure"] === true}
          onChange={(v) => set("smtp.secure", v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Username" value={text("smtp.user")} onChange={(e) => set("smtp.user", e.target.value)} error={fields["smtp.user"]} autoComplete="off" />
          <PasswordField
            label="Password"
            autoComplete="new-password"
            placeholder={s["smtp.pass"].set ? "Saved — type to replace" : ""}
            value={text("smtp.pass")}
            onChange={(e) => set("smtp.pass", e.target.value)}
            error={fields["smtp.pass"]}
            hint={secretHint(s["smtp.pass"])}
          />
        </div>
        <TextField
          label="From"
          placeholder='InFrame <no-reply@yourdomain.com>'
          value={text("smtp.from")}
          onChange={(e) => set("smtp.from", e.target.value)}
          error={fields["smtp.from"]}
        />
        <Actions
          section={section}
          onTest={() => { setResult(null); test.mutate(); }}
          testLabel={`Send test to ${me?.user.email ?? "me"}`}
          testing={test.isPending}
          result={result}
        />
      </form>
    </SectionCard>
  );
}
