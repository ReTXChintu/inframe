import { useSyncExternalStore } from "react";
import { api, ApiError, uploadWithProgress } from "./api";
import { queryClient } from "./queryClient";
import { connectSocket } from "./socket";
import type { Photo } from "./types";

/*
 * Upload queue that outlives the upload page: people can go back to the
 * gallery while a batch is still going. Each file is its own request (three
 * at a time) so every row gets real byte progress; after that, server-side
 * progress (storing → finding faces → matched) arrives over the socket.
 */

export type Stage = "queued" | "uploading" | "processing" | "storing" | "finding-faces" | "done" | "failed";

export interface UploadItem {
  key: string;
  eventId: string;
  file: File;
  previewUrl: string | null;
  folderId: string | null;
  stage: Stage;
  progress: number;
  photoId: string | null;
  faceCount: number | null;
  matchCount: number;
  error: string | null;
}

const CONCURRENCY = 3;
let items: UploadItem[] = [];
const listeners = new Set<() => void>();
let active = 0;

function emit() {
  items = [...items];
  for (const l of listeners) l();
}

function patch(key: string, change: Partial<UploadItem>) {
  const i = items.findIndex((x) => x.key === key);
  if (i === -1) return;
  const before = items[i]!;
  items[i] = { ...before, ...change };
  emit();
  // A photo became viewable (or finished scanning): refresh that event's
  // gallery + counts, even if the gallery isn't on screen right now.
  if (change.stage && change.stage !== before.stage && ["finding-faces", "done", "failed"].includes(change.stage)) {
    refreshEvent(before.eventId);
  }
}

const refreshTimers = new Map<string, number>();
function refreshEvent(eventId: string) {
  window.clearTimeout(refreshTimers.get(eventId));
  refreshTimers.set(
    eventId,
    window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["photos", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    }, 800),
  );
}

const previewable = (f: File) => /^image\/(jpeg|png|webp|gif|avif)$/.test(f.type);

export function addFiles(eventId: string, files: File[], folderId: string | null) {
  for (const file of files) {
    items.push({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      eventId,
      file,
      previewUrl: previewable(file) ? URL.createObjectURL(file) : null,
      folderId,
      stage: "queued",
      progress: 0,
      photoId: null,
      faceCount: null,
      matchCount: 0,
      error: null,
    });
  }
  emit();
  pump();
}

function pump() {
  while (active < CONCURRENCY) {
    const next = items.find((x) => x.stage === "queued");
    if (!next) return;
    active++;
    patch(next.key, { stage: "uploading", progress: 0, error: null });
    send(next).finally(() => {
      active--;
      pump();
    });
  }
}

async function send(item: UploadItem) {
  const form = new FormData();
  form.append("file", item.file, item.file.name);
  const qs = item.folderId ? `?folderId=${item.folderId}` : "";
  try {
    const res = await uploadWithProgress<{ photo: Photo }>(`/api/events/${item.eventId}/photos${qs}`, form, (p) =>
      // Once every byte is sent, the server is writing the file into Drive/MEGA.
      patch(item.key, p >= 1 ? { progress: 1, stage: "storing" } : { progress: p }),
    );
    patch(item.key, { stage: "processing", progress: 1, photoId: res.photo.id });
  } catch (err) {
    patch(item.key, { stage: "failed", error: err instanceof ApiError ? err.message : "Upload failed." });
  }
}

export function retry(key: string) {
  const item = items.find((x) => x.key === key);
  if (!item) return;
  if (item.photoId) {
    // It reached the server; ask the server to retry its part.
    api(`/api/photos/${item.photoId}/retry`, { method: "POST" })
      .then(() => patch(key, { stage: "processing", error: null }))
      .catch((err) => {
        // Server-side copy is gone: upload the file again from scratch.
        if (err instanceof ApiError && err.status === 400) {
          patch(key, { stage: "queued", photoId: null, error: null });
          pump();
        } else patch(key, { error: err.message });
      });
    return;
  }
  patch(key, { stage: "queued", error: null });
  pump();
}

export function clearFinished(eventId: string) {
  items = items.filter((x) => {
    const finished = x.eventId === eventId && (x.stage === "done" || x.stage === "failed");
    if (finished && x.previewUrl) URL.revokeObjectURL(x.previewUrl);
    return !finished;
  });
  emit();
}

export function cancelQueued(eventId: string) {
  items = items.filter((x) => !(x.eventId === eventId && x.stage === "queued"));
  emit();
}

// ─── Server progress ───────────────────────────────────────────────────
interface StatusEvent {
  photoId: string;
  status?: string;
  faceStatus?: string;
  stage?: string;
  faceCount?: number;
  matchCount?: number;
  error?: string;
}

function applyStatus(s: StatusEvent) {
  const item = items.find((x) => x.photoId === s.photoId);
  if (!item || item.stage === "done") return;
  if (s.status === "failed" || s.faceStatus === "failed") {
    patch(item.key, { stage: s.status === "failed" ? "failed" : "done", error: s.error ?? "Processing failed.", faceCount: null });
  } else if (s.faceStatus === "done") {
    patch(item.key, { stage: "done", faceCount: s.faceCount ?? 0, matchCount: s.matchCount ?? 0, error: null });
  } else if (s.stage === "storing") patch(item.key, { stage: "storing" });
  else if (s.stage === "finding-faces" || s.faceStatus === "processing" || s.status === "ready") patch(item.key, { stage: "finding-faces" });
  else if (s.stage === "retrying") patch(item.key, { error: `Retrying: ${s.error ?? ""}` });
}

let wiredSocket: ReturnType<typeof connectSocket> | null = null;
let polling = false;
function wire() {
  // The shared socket is recreated after sign-out/in, so re-attach when it changes.
  const s = connectSocket();
  if (s !== wiredSocket) {
    wiredSocket?.off("photo:status", applyStatus);
    s.on("photo:status", applyStatus);
    wiredSocket = s;
  }
  if (polling) return;
  polling = true;
  // Safety net if a socket message is missed (e.g. reconnect): poll in-flight photos.
  setInterval(async () => {
    const pending = items.filter((x) => x.photoId && ["processing", "storing", "finding-faces"].includes(x.stage));
    if (!pending.length) return;
    try {
      const { photos } = await api<{ photos: (StatusEvent & { id: string })[] }>("/api/photos/status", {
        body: { photoIds: pending.map((x) => x.photoId) },
      });
      for (const p of photos) applyStatus({ ...p, photoId: p.id });
    } catch {
      /* next tick */
    }
  }, 6000);
}

export function useUploads(eventId: string) {
  wire();
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
  return all.filter((x) => x.eventId === eventId);
}

/** Warn before closing the tab mid-upload. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (items.some((x) => x.stage === "queued" || x.stage === "uploading")) e.preventDefault();
  });
}
