import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FolderOpen, FolderPlus, MemoryStick, Plus } from "lucide-react";
import { Link } from "react-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PROVIDER_LABEL } from "@/lib/format";
import type { Connection, ProviderName } from "@/lib/types";
import { errorMessage, useFeedback } from "./feedback";
import { Button, cx, Modal, PasswordField, Spinner, TextField } from "./ui";

export interface StorageChoice {
  connectionId: string | null;
  mode: "new" | "existing";
  folder: string;
}

export const emptyStorageChoice: StorageChoice = { connectionId: null, mode: "new", folder: "" };

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () =>
      api<{ connections: Connection[]; googleEnabled: boolean; devMemoryStorage: boolean }>("/api/storage/connections"),
  });
}

/** Redirects the browser to Google's consent screen; Google sends it back to `returnTo`. */
export async function connectGoogle(returnTo: string) {
  const { url } = await api<{ url: string }>("/api/storage/google/start", { body: { returnTo } });
  window.location.assign(url);
}

/** Shown while the admin hasn't added a Google OAuth client yet. */
export function GoogleNotSetUp() {
  const { me } = useAuth();
  return me?.user.isAdmin ? (
    <p className="text-[12px] text-muted">
      Google Drive isn't set up yet.{" "}
      <Link to="/admin" className="font-semibold text-ink underline">
        Add it in Admin settings
      </Link>
    </p>
  ) : (
    <p className="text-[12px] text-muted">Google Drive isn't available yet — the admin hasn't set it up.</p>
  );
}

export function ProviderMark({ provider, className }: { provider: ProviderName; className?: string }) {
  if (provider === "memory") return <MemoryStick className={cx("size-5 text-muted", className)} aria-hidden />;
  return provider === "gdrive" ? (
    <svg viewBox="0 0 24 24" className={cx("size-5", className)} aria-hidden>
      <path d="M8.2 3h7.6l6 10.4h-7.6z" fill="#ffc107" />
      <path d="M2.2 13.4 6 20h12l3.8-6.6H2.2z" fill="#1e88e5" />
      <path d="M8.2 3 2.2 13.4 6 20l6-10.4z" fill="#4caf50" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={cx("size-5", className)} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#d9272e" />
      <path d="M7 16V8.5l5 5 5-5V16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MegaConnectModal({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected?: (c: Connection) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<{ connection: Connection }>("/api/storage/mega", { body: { email, password } }),
    onSuccess: ({ connection }) => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      setPassword("");
      onConnected?.(connection);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(errorMessage(err));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    save.mutate();
  };
  return (
    <Modal open={open} onClose={onClose} title="Connect MEGA" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-[14px] text-muted">
          InFrame signs in to your MEGA account to save and read event photos. Your password is stored encrypted and is only
          used for that. Accounts with two-factor login aren't supported.
        </p>
        {error && <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger">{error}</p>}
        <TextField label="MEGA email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoFocus />
        <PasswordField label="MEGA password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} />
        <Button type="submit" loading={save.isPending}>
          Connect MEGA
        </Button>
      </form>
    </Modal>
  );
}

/** Pick an account + folder for an event. Used by "New event" and event settings. */
export function StoragePicker({
  value,
  onChange,
  returnTo,
  newFolderHint,
}: {
  value: StorageChoice;
  onChange: (v: StorageChoice) => void;
  returnTo: string;
  newFolderHint: string;
}) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const { data, isLoading } = useConnections();
  const [megaOpen, setMegaOpen] = useState(false);
  const [resolved, setResolved] = useState<{ input: string; name: string } | null>(null);
  const connections = data?.connections ?? [];
  const selected = connections.find((c) => c.id === value.connectionId);

  const check = useMutation({
    mutationFn: () =>
      api<{ folder: { name: string } }>(`/api/storage/connections/${value.connectionId}/resolve`, { body: { folder: value.folder } }),
    onSuccess: ({ folder }) => setResolved({ input: value.folder, name: folder.name }),
    onError: (err) => {
      setResolved(null);
      toast(errorMessage(err), "error");
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Storage account">
        {connections.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value.connectionId === c.id}
            onClick={() => onChange({ ...value, connectionId: c.id })}
            className={cx(
              "flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors",
              value.connectionId === c.id ? "border-ink bg-surface ring-1 ring-ink" : "border-line bg-surface hover:bg-surface-2",
            )}
          >
            <ProviderMark provider={c.provider} className="size-6" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{PROVIDER_LABEL[c.provider]}</span>
              <span className="block truncate text-[13px] text-muted">{c.accountLabel}</span>
            </span>
            {c.status === "error" ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-warn">
                <AlertTriangle className="size-4" /> Reconnect
              </span>
            ) : (
              value.connectionId === c.id && <CheckCircle2 className="size-5 text-ink" />
            )}
          </button>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            icon={<ProviderMark provider="gdrive" className="size-4" />}
            disabled={!data?.googleEnabled}
            title={data?.googleEnabled ? undefined : "Google Drive isn't configured on this server"}
            onClick={() => connectGoogle(returnTo).catch((err) => toast(errorMessage(err), "error"))}
          >
            {connections.some((c) => c.provider === "gdrive") ? "Add another Google account" : "Connect Google Drive"}
          </Button>
          <Button variant="secondary" size="sm" icon={<ProviderMark provider="mega" className="size-4" />} onClick={() => setMegaOpen(true)}>
            Connect MEGA
          </Button>
          {data?.devMemoryStorage && !connections.some((c) => c.provider === "memory") && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ProviderMark provider="memory" className="size-4" />}
              onClick={() =>
                api<{ connection: Connection }>("/api/storage/dev-memory", { method: "POST" })
                  .then(({ connection }) => {
                    qc.invalidateQueries({ queryKey: ["connections"] });
                    onChange({ ...value, connectionId: connection.id });
                  })
                  .catch((err) => toast(errorMessage(err), "error"))
              }
            >
              Dev memory storage
            </Button>
          )}
        </div>
        {!data?.googleEnabled && <GoogleNotSetUp />}
      </div>

      {selected && (
        <div className="flex flex-col gap-3 animate-rise">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Folder">
            {(
              [
                { mode: "new", icon: FolderPlus, title: "Create a new folder", body: newFolderHint },
                { mode: "existing", icon: FolderOpen, title: "Use an existing folder", body: "Photos already in it are added too." },
              ] as const
            ).map((o) => (
              <button
                key={o.mode}
                type="button"
                role="radio"
                aria-checked={value.mode === o.mode}
                onClick={() => onChange({ ...value, mode: o.mode })}
                className={cx(
                  "flex gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                  value.mode === o.mode ? "border-ink ring-1 ring-ink" : "border-line hover:bg-surface-2",
                )}
              >
                <o.icon className="mt-0.5 size-5 shrink-0" />
                <span>
                  <span className="block font-medium">{o.title}</span>
                  <span className="block text-[13px] text-muted">{o.body}</span>
                </span>
              </button>
            ))}
          </div>
          {value.mode === "existing" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  label={selected.provider === "gdrive" ? "Google Drive folder link" : "MEGA folder link or path"}
                  placeholder={selected.provider === "gdrive" ? "https://drive.google.com/drive/folders/…" : "https://mega.nz/folder/… or Trips/Goa"}
                  value={value.folder}
                  onChange={(e) => {
                    setResolved(null);
                    onChange({ ...value, folder: e.target.value });
                  }}
                />
                <Button variant="secondary" className="mb-0.5" disabled={!value.folder.trim()} loading={check.isPending} onClick={() => check.mutate()}>
                  Check
                </Button>
              </div>
              {resolved && resolved.input === value.folder && (
                <p className="inline-flex items-center gap-1.5 text-[13px] text-ok">
                  <CheckCircle2 className="size-4" /> Found “{resolved.name}”
                </p>
              )}
              <p className="text-[12px] text-muted">
                The folder must belong to the connected {PROVIDER_LABEL[selected.provider]} account. Sub-folders become albums.
              </p>
            </div>
          )}
        </div>
      )}

      {connections.length === 0 && (
        <p className="flex items-center gap-2 text-[14px] text-muted">
          <Plus className="size-4" /> Connect an account to keep this event's photos in your own storage.
        </p>
      )}

      <MegaConnectModal open={megaOpen} onClose={() => setMegaOpen(false)} onConnected={(c) => onChange({ ...value, connectionId: c.id })} />
    </div>
  );
}
