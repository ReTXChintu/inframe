import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Camera,
  FolderPlus,
  Images,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ScanFace,
  Settings2,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRange, KIND_LABEL, plural } from "@/lib/format";
import { useSocketEvent, useWatchEvent } from "@/lib/socket";
import type { EventDetail, Folder, Person } from "@/lib/types";
import { errorMessage, useFeedback } from "@/components/feedback";
import { Lightbox } from "@/components/Lightbox";
import { GridSkeleton, PhotoGrid, usePhotoFeed } from "@/components/PhotoGrid";
import { SelectionBar } from "@/components/SelectionBar";
import { SelfieModal } from "@/components/SelfieCapture";
import { ShareSheet } from "@/components/ShareSheet";
import { StoragePendingBanner, storagePendingMessage, TrippinChip } from "@/components/Trippin";
import { Button, Callout, Chip, EmptyState, ErrorBanner, IconTile, LinkButton, Modal, Segmented, Spinner, TextField } from "@/components/ui";
import { LoadingBlock } from "./Events";

type View =
  | { kind: "all" }
  | { kind: "me" }
  | { kind: "person"; id: string }
  | { kind: "favorites" }
  | { kind: "uploads" }
  | { kind: "folder"; id: string };

function parseView(raw: string | null): View {
  if (!raw) return { kind: "all" };
  const [kind, id] = raw.split(":");
  if ((kind === "person" || kind === "folder") && id) return { kind, id };
  if (kind === "me" || kind === "favorites" || kind === "uploads" || kind === "all") return { kind };
  return { kind: "all" };
}
const viewKey = (v: View) => ("id" in v ? `${v.kind}:${v.id}` : v.kind);

function viewUrl(eventId: string, v: View, order: string) {
  const base = `/api/events/${eventId}/photos?order=${order}&view=${v.kind}`;
  if (v.kind === "person") return `${base}&personId=${v.id}`;
  if (v.kind === "folder") return `${base}&folderId=${v.id}`;
  return base;
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ["event", id],
    enabled: Boolean(id),
    queryFn: () => api<{ event: EventDetail }>(`/api/events/${id}`).then((r) => r.event),
  });
}

export function EventPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: event, isLoading, error } = useEvent(id);
  const [shareOpen, setShareOpen] = useState(params.get("share") === "1");
  const [selfieFor, setSelfieFor] = useState<Person | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastToggled = useRef<number | null>(null);
  const [order, setOrder] = useState<"newest" | "oldest">("newest");

  useWatchEvent(id);

  // Default view: the full gallery when allowed, otherwise your matches.
  const requested = parseView(params.get("view"));
  const view: View = useMemo(() => {
    if (!event) return requested;
    const allowed =
      (requested.kind === "all" || requested.kind === "folder" ? event.can.viewAll : true) &&
      (requested.kind === "me" || requested.kind === "person" ? event.can.faceSearch : true);
    if (allowed) return requested;
    return event.can.faceSearch ? { kind: "me" } : { kind: "favorites" };
  }, [event, requested]);

  const setView = (v: View) => {
    setSelected(new Set());
    setParams((p) => {
      p.set("view", viewKey(v));
      p.delete("share");
      return p;
    }, { replace: true });
  };

  const feed = usePhotoFeed([id, viewKey(view), order], event ? viewUrl(event.id, view, order) : null);

  // Live updates: debounce refetches while a batch is processing.
  const refetchTimer = useRef<number | undefined>(undefined);
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["photos", id] });
      qc.invalidateQueries({ queryKey: ["event", id] });
    }, 1200);
  }, [qc, id]);
  useSocketEvent<{ eventId: string; status?: string; faceStatus?: string }>("photo:status", (p) => {
    if (p.eventId === id && (p.status === "ready" || p.faceStatus === "done" || p.status === "failed" || p.faceStatus === "failed")) scheduleRefresh();
  });
  useSocketEvent<{ eventId: string }>("photos:deleted", (p) => p.eventId === id && scheduleRefresh());
  useSocketEvent<{ eventId: string }>("event:updated", (p) => p.eventId === id && qc.invalidateQueries({ queryKey: ["event", id] }));
  useSocketEvent<{ eventId: string }>("event:sync", (p) => p.eventId === id && scheduleRefresh());
  useSocketEvent<{ eventId: string }>("event:members", (p) => p.eventId === id && qc.invalidateQueries({ queryKey: ["event", id] }));

  useEffect(() => setSelected(new Set()), [id]);

  if (isLoading) return <LoadingBlock />;
  if (error || !event) {
    return (
      <EmptyState
        icon={<Images className="size-8" />}
        title="Event not found"
        body="It may have been deleted, or you're not a member."
        action={<LinkButton to="/" variant="secondary">Back to events</LinkButton>}
      />
    );
  }

  const photos = feed.photos;
  const self = event.people.find((p) => p.kind === "self");
  const family = event.people.filter((p) => p.kind === "family" && p.hasSelfie);
  const canDeleteSelection = event.isHost || photos.filter((p) => selected.has(p.id)).every((p) => p.uploaderId === me?.user.id);

  function toggle(photoId: string, index: number, range: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && lastToggled.current !== null) {
        const [a, b] = [lastToggled.current, index].sort((x, y) => x - y);
        for (let i = a!; i <= b!; i++) next.add(photos[i]!.id);
      } else if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    lastToggled.current = index;
  }

  const tabs: { view: View; label: string; count: number | null }[] = [
    ...(event.can.viewAll ? [{ view: { kind: "all" } as View, label: "All photos", count: event.counts.all }] : []),
    ...(event.can.faceSearch && self?.hasSelfie ? [{ view: { kind: "me" } as View, label: "You", count: event.counts.me }] : []),
    ...(event.can.faceSearch ? family.map((p) => ({ view: { kind: "person", id: p.id } as View, label: p.name, count: p.eventCount ?? 0 })) : []),
    { view: { kind: "favorites" }, label: "Favourites", count: event.counts.favorites },
    ...(event.can.upload || event.counts.uploads ? [{ view: { kind: "uploads" } as View, label: "Your uploads", count: event.counts.uploads }] : []),
  ];
  const activeFolder = view.kind === "folder" ? event.folders.find((f) => f.id === view.id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <EventHeader event={event} onShare={() => setShareOpen(true)} />
      <StoragePendingBanner event={event} />

      {event.can.faceSearch && (
        !self?.hasSelfie ? (
          <Callout
            tone="info"
            icon={<ScanFace />}
            title="Find the photos you're in"
            className="animate-rise"
            action={
              <Button icon={<Camera className="size-[18px]" />} onClick={() => setSelfieFor(self ?? null)} disabled={!self}>
                Take a selfie
              </Button>
            }
          >
            Take a quick selfie. InFrame checks every photo in this event — and every new one.
          </Callout>
        ) : event.counts.me > 0 && view.kind !== "me" ? (
          <button
            onClick={() => setView({ kind: "me" })}
            className="group flex items-center gap-3 rounded-lg bg-ac-soft px-4 py-3 text-left transition-shadow duration-[120ms] hover:shadow-[inset_0_0_0_1px_var(--ac-line)] animate-rise"
          >
            <IconTile tone="onTint" className="text-ac">
              <ScanFace />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="num text-title-section text-tx">You're in {plural(event.counts.me, "photo")}</p>
              <p className="text-caption text-tx2">Tap to see them all.</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-ac">
              <span className="num">{event.counts.me} found</span>
              <ChevronRight className="size-4" aria-hidden />
            </span>
          </button>
        ) : null
      )}

      {/* View switcher */}
      <div className="flex flex-col gap-3">
        {/* Chips scroll sideways on phones and wrap on wider screens (§6.3). */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Photo views">
          {tabs.map((t) => {
            const active = viewKey(t.view) === viewKey(view);
            return (
              <Chip key={viewKey(t.view)} role="tab" aria-selected={active} selected={active} count={t.count} onClick={() => setView(t.view)}>
                {t.label}
              </Chip>
            );
          })}
          {event.can.viewAll &&
            event.folders.map((f) => {
              const active = view.kind === "folder" && view.id === f.id;
              return (
                <Chip
                  key={f.id}
                  role="tab"
                  aria-selected={active}
                  selected={active}
                  dashed
                  count={f.count}
                  onClick={() => setView({ kind: "folder", id: f.id })}
                >
                  {f.name}
                </Chip>
              );
            })}
          {event.isHost && <NewAlbumButton eventId={event.id} />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="num text-body-s text-tx3">
            {activeFolder ? (
              <AlbumActions folder={activeFolder} eventId={event.id} isHost={event.isHost} onDeleted={() => setView({ kind: "all" })} />
            ) : (
              <>
                {feed.isFetching && !feed.isFetchingNextPage ? "Updating…" : photos.length ? `${plural(photos.length, "photo")}${feed.hasNextPage ? "+" : ""}` : ""}
              </>
            )}
          </p>
          <Segmented
            label="Order"
            value={order}
            onChange={setOrder}
            options={[
              { value: "oldest", label: "Oldest first" },
              { value: "newest", label: "Newest first" },
            ]}
          />
        </div>
      </div>

      {feed.isLoading ? (
        <GridSkeleton />
      ) : feed.error ? (
        <ErrorBanner>{errorMessage(feed.error)}</ErrorBanner>
      ) : photos.length === 0 ? (
        <EmptyForView view={view} event={event} onSelfie={() => setSelfieFor(self ?? null)} />
      ) : (
        <PhotoGrid
          photos={photos}
          selected={selected}
          onToggle={(p, range) => toggle(p.id, photos.indexOf(p), range)}
          onOpen={setLightbox}
          hasMore={Boolean(feed.hasNextPage)}
          loadMore={() => feed.fetchNextPage()}
          loadingMore={feed.isFetchingNextPage}
        />
      )}

      <SelectionBar
        selected={selected}
        photos={photos}
        canDelete={canDeleteSelection}
        onClear={() => setSelected(new Set())}
        onSelectAll={() => setSelected(new Set(photos.map((p) => p.id)))}
      />

      {lightbox !== null && photos[lightbox] && (
        <Lightbox
          photos={photos}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onNeedMore={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        />
      )}
      <ShareSheet event={event} open={shareOpen} onClose={() => setShareOpen(false)} />
      <SelfieModal person={selfieFor} open={Boolean(selfieFor)} onClose={() => setSelfieFor(null)} />
    </div>
  );
}

function EventHeader({ event, onShare }: { event: EventDetail; onShare: () => void }) {
  const range = formatRange(event.startsOn, event.endsOn);
  const s = event.storage;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        {event.coverUrl && (
          <img src={event.coverUrl} alt="" className="hidden size-16 shrink-0 rounded-lg object-cover sm:block" />
        )}
        <div className="min-w-0 flex-1">
          <div className="num flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-s text-tx3">
            <span className="text-label text-tx2">{KIND_LABEL[event.kind]}</span>
            {range && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden /> {range}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> {plural(event.counts.members, "member")}
            </span>
            <TrippinChip link={event.external} />
          </div>
          <h1 className="mt-1 text-title-page break-words">{event.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<UserPlus className="size-[18px]" />} onClick={onShare}>
            Invite
          </Button>
          {event.can.upload && (
            <LinkButton to={`/events/${event.id}/upload`} icon={<UploadCloud className="size-[18px]" />}>
              Add photos
            </LinkButton>
          )}
          <LinkButton to={`/events/${event.id}/settings`} variant="secondary" icon={<Settings2 className="size-[18px]" />}>
            <span className="sr-only sm:not-sr-only">{event.isHost ? "Settings" : "Details"}</span>
          </LinkButton>
        </div>
      </div>

      {event.isHost && (s.status === "error" || s.syncState === "error" || (!s.connected && !s.pending) || (event.counts.failed ?? 0) > 0 || (event.counts.processing ?? 0) > 0 || s.syncState === "syncing") && (
        <HostStatus event={event} />
      )}
    </div>
  );
}

function HostStatus({ event }: { event: EventDetail }) {
  const s = event.storage;
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const retry = useMutation({
    mutationFn: () => api<{ queued: number }>(`/api/events/${event.id}/reprocess`, { body: { scope: "failed" } }),
    onSuccess: ({ queued }) => {
      toast(`Retrying ${plural(queued, "photo")}.`);
      qc.invalidateQueries({ queryKey: ["event", event.id] });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  const items: React.ReactNode[] = [];
  if (s.pending) {
    // The banner above the photos asks the owner to connect a folder.
  } else if (!s.connected) {
    items.push(
      <span key="nc" className="inline-flex items-center gap-1.5 text-warn">
        <AlertTriangle className="size-4" /> No storage folder connected — uploads are off.{" "}
        <Link to={`/events/${event.id}/settings#storage`} className="font-semibold underline underline-offset-2">Fix</Link>
      </span>,
    );
  } else if (s.status === "error") {
    items.push(
      <span key="se" className="inline-flex items-center gap-1.5 text-warn">
        <AlertTriangle className="size-4" /> {s.error ?? "The storage account needs reconnecting."}{" "}
        <Link to="/settings#storage" className="font-semibold underline underline-offset-2">Reconnect</Link>
      </span>,
    );
  } else if (s.syncState === "error") {
    items.push(
      <span key="sy" className="inline-flex items-center gap-1.5 text-warn">
        <AlertTriangle className="size-4" /> Sync failed: {s.syncError}
      </span>,
    );
  }
  if (s.syncState === "syncing") {
    items.push(
      <span key="sync" className="inline-flex items-center gap-2">
        <Spinner size={16} /> Checking {s.folderName ?? "the folder"} for new photos…
      </span>,
    );
  }
  if ((event.counts.processing ?? 0) > 0) {
    items.push(
      <span key="proc" className="inline-flex items-center gap-2">
        <RefreshCw className="size-3.5 animate-spin" /> Processing {plural(event.counts.processing!, "photo")}
      </span>,
    );
  }
  if ((event.counts.failed ?? 0) > 0) {
    items.push(
      <span key="fail" className="inline-flex items-center gap-2 font-medium text-crit">
        <span className="size-2 rounded-full bg-crit-fill" aria-hidden />
        {plural(event.counts.failed!, "photo")} failed
        <button onClick={() => retry.mutate()} disabled={retry.isPending} className="font-semibold text-ac hover:underline">
          Retry
        </button>
      </span>,
    );
  }
  return (
    <div className="num flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-ln bg-sf px-4 py-3 text-body-s text-tx2">{items}</div>
  );
}

function EmptyForView({ view, event, onSelfie }: { view: View; event: EventDetail; onSelfie: () => void }) {
  const upload = event.can.upload ? (
    <LinkButton to={`/events/${event.id}/upload`} icon={<UploadCloud className="size-4" />}>
      Add photos
    </LinkButton>
  ) : undefined;
  switch (view.kind) {
    case "me":
      return (
        <EmptyState
          icon={<ScanFace className="size-8" />}
          title="No photos of you yet"
          body="As soon as someone adds a photo you're in, it shows up here. If you think we're missing some, try a clearer selfie."
          action={<Button variant="secondary" onClick={onSelfie}>Retake selfie</Button>}
        />
      );
    case "person":
      return <EmptyState icon={<ScanFace className="size-8" />} title="Not found in any photos yet" body="New photos are checked as they arrive." />;
    case "favorites":
      return <EmptyState icon={<Images className="size-8" />} title="No favourites" body="Tap the heart on a photo to keep it here." />;
    case "uploads":
      return <EmptyState icon={<UploadCloud className="size-8" />} title="You haven't added photos" action={upload} />;
    default:
      return (
        <EmptyState
          icon={<Images className="size-8" />}
          title="No photos yet"
          body={
            event.storage.pending
              ? storagePendingMessage(event.isOwner)
              : event.storage.syncState === "syncing"
                ? "Bringing in photos from the storage folder…"
                : "Be the first to add some."
          }
          action={upload}
        />
      );
  }
}

function NewAlbumButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const create = useMutation({
    mutationFn: () => api<{ folder: Folder }>(`/api/events/${eventId}/folders`, { body: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      setOpen(false);
      setName("");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-ln2 px-3.5 text-[13px] font-semibold text-ac transition-colors hover:bg-sf2"
      >
        <FolderPlus className="size-4" /> Album
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New album"
        size="sm"
        footer={
          <Button size="lg" onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>
            Create album
          </Button>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <TextField label="Album name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus hint="Photos uploaded to it go into a sub-folder with this name." />
        </form>
      </Modal>
    </>
  );
}

function AlbumActions({ folder, eventId, isHost, onDeleted }: { folder: Folder; eventId: string; isHost: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [menu, setMenu] = useState(false);
  const rename = useMutation({
    mutationFn: () => api(`/api/folders/${folder.id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      setRenaming(false);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/folders/${folder.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      onDeleted();
    },
  });
  return (
    <span className="relative inline-flex items-center gap-2">
      <span>
        Album · {plural(folder.count, "photo")}
      </span>
      {isHost && (
        <>
          <button
            type="button"
            aria-label="Album options"
            title="Album options"
            onClick={() => setMenu((m) => !m)}
            className="inline-flex size-8 items-center justify-center rounded-full text-tx2 transition-colors hover:bg-sf2 hover:text-tx"
          >
            <MoreHorizontal className="size-[18px]" />
          </button>
          {menu && (
            <span role="menu" className="absolute top-9 left-0 z-20 w-48 rounded-lg border border-ln bg-sf p-1 shadow-2 animate-pop">
              <button role="menuitem" className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-[14px] text-tx hover:bg-sf2" onClick={() => { setMenu(false); setRenaming(true); }}>
                <Pencil className="size-[18px]" /> Rename
              </button>
              <button
                role="menuitem"
                className="flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-[14px] text-crit hover:bg-crit-soft"
                onClick={async () => {
                  setMenu(false);
                  if (await confirm({ title: `Delete album “${folder.name}”?`, body: "The photos stay in the event (under All photos). Nothing is deleted from storage.", confirmLabel: "Delete album", danger: true })) remove.mutate();
                }}
              >
                <Trash2 className="size-[18px]" /> Delete album
              </button>
            </span>
          )}
          <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename album" size="sm" footer={<Button size="lg" onClick={() => rename.mutate()} loading={rename.isPending} disabled={!name.trim()}>Save</Button>}>
            <TextField label="Album name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </Modal>
        </>
      )}
    </span>
  );
}
