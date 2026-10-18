import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, RefreshCw, ScanFace, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatRange, KIND_LABEL, plural, prettyCode, PROVIDER_LABEL, ROLE_LABEL, timeAgo } from "@/lib/format";
import type { EventDetail, EventKind, Member, PendingInvite } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { ShareSheet } from "@/components/ShareSheet";
import { emptyStorageChoice, ProviderMark, StoragePicker, type StorageChoice } from "@/components/StoragePicker";
import { Avatar, Badge, Button, Card, EmptyState, IconButton, Modal, SelectField, TextField, Toggle } from "@/components/ui";
import { useEvent } from "./Event";
import { LoadingBlock } from "./Events";

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="scroll-mt-24 p-5 sm:p-6">
      <section id={id} aria-labelledby={id ? `${id}-title` : undefined}>
        <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
        <div className="mt-4">{children}</div>
      </section>
    </Card>
  );
}

export function EventSettingsPage() {
  const { id } = useParams();
  const { data: event, isLoading } = useEvent(id);
  const location = useLocation();

  useEffect(() => {
    if (location.hash && event) document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, event]);

  if (isLoading) return <LoadingBlock />;
  if (!event) return <EmptyState icon={<X className="size-8" />} title="Event not found" />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to={`/events/${event.id}`} className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> {event.name}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{event.isHost ? "Event settings" : "Event details"}</h1>
      </div>
      {/* Wide screens: the event itself on the left, people + storage on the right. */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          {event.isHost ? <GeneralSection event={event} /> : <ReadOnlyDetails event={event} />}
          {event.isHost && <PrivacySection event={event} />}
          {event.isHost && <MaintenanceSection event={event} />}
        </div>
        <div className="flex flex-col gap-5">
          <MembersSection event={event} />
          <StorageSection event={event} />
          <DangerSection event={event} />
        </div>
      </div>
    </div>
  );
}

function usePatchEvent(event: EventDetail) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ event: EventDetail }>(`/api/events/${event.id}`, { method: "PATCH", body }),
    onSuccess: ({ event: updated }) => {
      qc.setQueryData(["event", event.id], updated);
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
}

function ReadOnlyDetails({ event }: { event: EventDetail }) {
  return (
    <Section title="About">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
        <dt className="text-muted">Kind</dt>
        <dd>{KIND_LABEL[event.kind]}</dd>
        <dt className="text-muted">Dates</dt>
        <dd>{formatRange(event.startsOn, event.endsOn) ?? "—"}</dd>
        <dt className="text-muted">Hosted by</dt>
        <dd>{event.owner.name}</dd>
        <dt className="text-muted">Your role</dt>
        <dd>{ROLE_LABEL[event.role]}</dd>
      </dl>
    </Section>
  );
}

function GeneralSection({ event }: { event: EventDetail }) {
  const { toast } = useFeedback();
  const patch = usePatchEvent(event);
  const [name, setName] = useState(event.name);
  const [kind, setKind] = useState<EventKind>(event.kind);
  const [startsOn, setStartsOn] = useState(event.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(event.endsOn ?? "");
  const dirty = name !== event.name || kind !== event.kind || startsOn !== (event.startsOn ?? "") || endsOn !== (event.endsOn ?? "");

  return (
    <Section title="Details">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          patch.mutate({ name, kind, startsOn: startsOn || null, endsOn: endsOn || null }, { onSuccess: () => toast("Saved.") });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          <SelectField label="Kind" value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
            {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          <TextField label="Ends" type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty || !name.trim()} loading={patch.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PrivacySection({ event }: { event: EventDetail }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const patch = usePatchEvent(event);
  const s = event.settings;
  const rotate = useMutation({
    mutationFn: () => api<{ joinCode: string }>(`/api/events/${event.id}/join-code`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      toast("New code created. The old code and QR no longer work.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  return (
    <Section title="Sharing & privacy" description="Hosts always see everything. These settings apply to guests.">
      <div className="divide-y divide-line">
        <Toggle
          label="Anyone with the code or link can join"
          description="Turn off to allow only people you invite by email."
          checked={s.joinEnabled}
          onChange={(v) => patch.mutate({ joinEnabled: v })}
        />
        <Toggle
          label="Guests can add photos"
          description="Off: only you and co-hosts can upload."
          checked={s.guestUploads}
          onChange={(v) => patch.mutate({ guestUploads: v })}
        />
        <Toggle
          label="Guests see all photos"
          description="Off: guests see only photos they're in, their uploads and favourites."
          checked={s.guestsSeeAll}
          onChange={(v) => {
            if (!v && !s.faceSearch) return toast("Turn on face search first, or guests would see nothing.", "error");
            patch.mutate({ guestsSeeAll: v });
          }}
        />
        <Toggle
          label="Face search"
          description="Guests can find the photos they and their family are in."
          checked={s.faceSearch}
          onChange={(v) => {
            if (!v && !s.guestsSeeAll) return toast("Let guests see all photos first, or they'd see nothing.", "error");
            patch.mutate({ faceSearch: v });
          }}
        />
      </div>
      {event.joinCode && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <span className="text-[13px] text-muted">Join code</span>
          <span className="font-display text-xl font-semibold tracking-[0.08em] tabular-nums">{prettyCode(event.joinCode)}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            icon={<RefreshCw className="size-3.5" />}
            loading={rotate.isPending}
            onClick={async () => {
              if (await confirm({ title: "Make a new join code?", body: "The current code, link and QR stop working. People already in the event stay in.", confirmLabel: "New code" })) rotate.mutate();
            }}
          >
            New code
          </Button>
        </div>
      )}
    </Section>
  );
}

function StorageSection({ event }: { event: EventDetail }) {
  const s = event.storage;
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [changing, setChanging] = useState(params.get("storage") !== null);
  const [choice, setChoice] = useState<StorageChoice>(emptyStorageChoice);

  useEffect(() => {
    const st = params.get("storage");
    if (!st) return;
    if (st === "connected") toast("Google Drive connected.");
    else if (st !== "cancelled") toast("Couldn't connect Google Drive.", "error");
    setParams({}, { replace: true });
    qc.invalidateQueries({ queryKey: ["connections"] });
  }, [params, setParams, toast, qc]);

  const sync = useMutation({
    mutationFn: () => api(`/api/events/${event.id}/sync`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      toast("Checking the folder for new photos…", "info");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const change = useMutation({
    mutationFn: () =>
      api<{ removedPhotos: number }>(`/api/events/${event.id}/storage`, {
        method: "PUT",
        body: { connectionId: choice.connectionId, folder: choice.mode === "existing" ? choice.folder : null },
      }),
    onSuccess: ({ removedPhotos }) => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      qc.invalidateQueries({ queryKey: ["photos", event.id] });
      setChanging(false);
      toast(removedPhotos ? `Storage changed. ${plural(removedPhotos, "photo")} from the old folder were removed from InFrame.` : "Storage updated.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  return (
    <Section
      id="storage"
      title="Storage"
      description="Original photos live in this folder. Photos added to it directly are picked up automatically."
    >
      {s.connected && s.provider ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl border border-line p-4">
            <ProviderMark provider={s.provider} className="size-7" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.folderName ?? "Folder"} <span className="font-normal text-muted">· {PROVIDER_LABEL[s.provider]}</span>
              </p>
              <p className="truncate text-[13px] text-muted">
                {s.accountLabel ? `${s.accountLabel} · ` : ""}
                {s.syncState === "syncing" ? "Syncing now…" : `Last checked ${timeAgo(s.lastSyncedAt)}`}
              </p>
              {(s.error || s.syncError) && <p className="mt-1 text-[13px] text-warn">{s.error ?? s.syncError}</p>}
            </div>
            {s.folderUrl && (
              <a
                href={s.folderUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open folder in a new tab"
                title="Open folder in a new tab"
                className="inline-flex size-10 items-center justify-center rounded-full hover:bg-surface-2"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
          {event.isHost && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={sync.isPending} disabled={s.syncState === "syncing"} onClick={() => sync.mutate()}>
                Sync now
              </Button>
              {event.isOwner && (
                <Button variant="ghost" onClick={() => setChanging(true)}>
                  Change folder…
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[15px] text-warn">No storage folder connected — nobody can add photos until one is set.</p>
          {event.isOwner ? (
            <Button onClick={() => setChanging(true)}>Connect a folder</Button>
          ) : (
            <p className="text-[14px] text-muted">Only the owner can connect storage.</p>
          )}
        </div>
      )}

      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        title="Choose the event's storage"
        footer={
          <Button
            loading={change.isPending}
            disabled={!choice.connectionId || (choice.mode === "existing" && !choice.folder.trim())}
            onClick={async () => {
              if (s.connected && !(await confirm({
                title: "Switch storage folder?",
                body: "Photos from the current folder will be removed from InFrame (the files stay in your storage), and the new folder will be indexed.",
                confirmLabel: "Switch folder",
                danger: true,
              }))) return;
              change.mutate();
            }}
          >
            Use this folder
          </Button>
        }
      >
        <StoragePicker value={choice} onChange={setChoice} returnTo={`/events/${event.id}/settings`} newFolderHint={`“InFrame · ${event.name}” in your storage.`} />
      </Modal>
    </Section>
  );
}

function MaintenanceSection({ event }: { event: EventDetail }) {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (scope: "failed" | "all") => api<{ queued: number }>(`/api/events/${event.id}/reprocess`, { body: { scope } }),
    onSuccess: ({ queued }) => {
      qc.invalidateQueries({ queryKey: ["event", event.id] });
      toast(queued ? `Queued ${plural(queued, "photo")}.` : "Nothing to redo.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  return (
    <Section title="Photo processing">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-[14px] text-muted">
          {event.counts.failed ? `${plural(event.counts.failed, "photo")} failed to process.` : "Every photo processed fine."}{" "}
          {event.counts.processing ? `${plural(event.counts.processing, "photo")} in progress.` : ""}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!event.counts.failed} loading={run.isPending && run.variables === "failed"} onClick={() => run.mutate("failed")}>
            Retry failed
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ScanFace className="size-4" />}
            loading={run.isPending && run.variables === "all"}
            onClick={async () => {
              if (await confirm({ title: "Re-scan every photo?", body: "Faces are detected again for all photos in this event. Useful after the face model is upgraded.", confirmLabel: "Re-scan" })) run.mutate("all");
            }}
          >
            Re-scan all faces
          </Button>
        </div>
      </div>
    </Section>
  );
}

function MembersSection({ event }: { event: EventDetail }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [shareOpen, setShareOpen] = useState(false);
  const members = useQuery({
    queryKey: ["members", event.id],
    queryFn: () => api<{ members: Member[] }>(`/api/events/${event.id}/members`).then((r) => r.members),
  });
  const invites = useQuery({
    queryKey: ["invites", event.id],
    enabled: event.isHost,
    queryFn: () => api<{ invites: PendingInvite[] }>(`/api/events/${event.id}/invites`).then((r) => r.invites),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["members", event.id] });
    qc.invalidateQueries({ queryKey: ["event", event.id] });
  };
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "cohost" | "member" }) =>
      api(`/api/events/${event.id}/members/${userId}`, { method: "PATCH", body: { role } }),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/api/events/${event.id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api(`/api/events/${event.id}/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invites", event.id] }),
  });

  return (
    <Section title={`People · ${event.counts.members}`}>
      <ul className="divide-y divide-line">
        {(members.data ?? []).map((m) => {
          const canRemove = !m.isYou && m.role !== "owner" && event.isHost && (m.role === "member" || event.isOwner);
          return (
            <li key={m.userId} className="flex items-center gap-3 py-3">
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.name} {m.isYou && <span className="font-normal text-muted">(you)</span>}
                </p>
                {m.email && <p className="truncate text-[13px] text-muted">{m.email}</p>}
              </div>
              {event.isOwner && m.role !== "owner" ? (
                <select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as "cohost" | "member" })}
                  className="h-8 rounded-full border border-line bg-surface px-3 text-[13px]"
                >
                  <option value="member">Guest</option>
                  <option value="cohost">Co-host</option>
                </select>
              ) : (
                <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
              )}
              {canRemove && (
                <IconButton
                  label={`Remove ${m.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Remove ${m.name}?`, body: "They lose access to this event. Photos they added stay.", confirmLabel: "Remove", danger: true })) removeMember.mutate(m.userId);
                  }}
                >
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
      {event.isHost && (invites.data?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[13px] font-medium text-muted">Invited, not joined yet</p>
          <ul className="flex flex-col gap-1.5">
            {invites.data!.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                {inv.role === "cohost" && <Badge>Co-host</Badge>}
                <span className="text-[12px] text-muted">{timeAgo(inv.createdAt)}</span>
                <button className="text-[13px] font-medium text-danger hover:underline" onClick={() => revoke.mutate(inv.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4">
        <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setShareOpen(true)}>
          Invite people
        </Button>
      </div>
      <ShareSheet event={event} open={shareOpen} onClose={() => setShareOpen(false)} />
    </Section>
  );
}

function DangerSection({ event }: { event: EventDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const leave = useMutation({
    mutationFn: async () => {
      const me = qc.getQueryData<{ user: { id: string } }>(["me"]);
      return api(`/api/events/${event.id}/members/${me?.user.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      navigate("/");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/events/${event.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      toast("Event deleted.");
      navigate("/");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  return (
    <Section title={event.isOwner ? "Delete event" : "Leave event"}>
      {event.isOwner ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-[14px] text-muted">
            Removes the event, its albums and face matches from InFrame for everyone. The photo files stay in your storage folder.
          </p>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: `Delete “${event.name}”?`, body: "This can't be undone. Files in your Drive/MEGA folder are not touched.", confirmLabel: "Delete event", danger: true })) remove.mutate();
            }}
          >
            Delete event
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-[14px] text-muted">You'll stop seeing this event. Photos you added stay in it.</p>
          <Button
            variant="secondary"
            className="text-danger"
            loading={leave.isPending}
            onClick={async () => {
              if (await confirm({ title: `Leave “${event.name}”?`, confirmLabel: "Leave", danger: true })) leave.mutate();
            }}
          >
            Leave event
          </Button>
        </div>
      )}
    </Section>
  );
}
