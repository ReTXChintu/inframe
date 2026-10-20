import { useSyncExternalStore } from "react";
import { api, ApiError, uploadWithProgress } from "./api";
import { queryClient } from "./queryClient";
import { connectSocket } from "./socket";
import type { Photo } from "./types";

/*
 * Upload queue that outlives the upload page: people can go back to the
 * gallery while a batch is still going. Each file is its own request (three
 * at a time) so every row gets real byte progress. The server answers as soon
 * as it has the bytes; its workers then store the file in Drive/MEGA, make
 * previews and scan faces, and that progress arrives over the socket.
 */

export type Stage = "queued" | "uploading" | "received" | "storing" | "processing" | "finding-faces" | "done" | "failed";

export interface UploadItem {
  key: string;
  eventId: string;
  file: File;
  isVideo: boolean;
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
export const isVideoFile = (f: File) =>
  f.type.startsWith("video/") || /\.(mp4|m4v|mov|qt|webm|mkv|avi|3gp|3g2|mts|m2ts|mpe?g|wmv)$/i.test(f.name);

/** "Same file" fingerprint used for duplicate checks: name + size + last-modified. */
export const fileKey = (f: File) => `${f.name.toLowerCase()}|${f.size}|${f.lastModified}`;

/**
 * Which of these files are already in the event (or already queued here)?
 * Returns the set of `fileKey`s that would be duplicates.
 */
export async function findDuplicates(eventId: string, files: File[]): Promise<Set<string>> {
  const dupes = new Set<string>();
  // Already queued in this browser for the same event.
  for (const i of items) if (i.eventId === eventId && i.stage !== "failed") dupes.add(fileKey(i.file));
  const unique = new Map<string, File>();
  for (const f of files) if (!unique.has(fileKey(f))) unique.set(fileKey(f), f);
  const list = [...unique.entries()];
  for (let i = 0; i < list.length; i += 2000) {
    const chunk = list.slice(i, i + 2000);
    const res = await api<{ duplicates: string[] }>(`/api/events/${eventId}/uploads/check`, {
      body: { files: chunk.map(([key, f]) => ({ key, name: f.name, size: f.size, modifiedAt: f.lastModified })) },
    });
    for (const k of res.duplicates) dupes.add(k);
  }
  return dupes;
}

export function addFiles(eventId: string, files: File[], folderId: string | null) {
  // A file picked twice in one go is only sent once.
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(fileKey(file))) continue;
    seen.add(fileKey(file));
    items.push({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      eventId,
      file,
      isVideo: isVideoFile(file),
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
  const params = new URLSearchParams({ modifiedAt: String(item.file.lastModified) });
  if (item.folderId) params.set("folderId", item.folderId);
  try {
    const res = await uploadWithProgress<{ photo: Photo }>(`/api/events/${item.eventId}/photos?${params}`, form, (p) =>
      patch(item.key, { progress: p }),
    );
    // The server has it; a worker stores it in Drive/MEGA next. Safe to close the tab from here on.
    patch(item.key, { stage: "received", progress: 1, photoId: res.photo.id });
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
  } else if (s.faceStatus === "skipped" && s.status === "ready") {
    patch(item.key, { stage: "done", faceCount: null, error: null }); // videos aren't face-scanned
  } else if (s.stage === "storing") patch(item.key, { stage: "storing", error: null });
  else if (s.stage === "processing") patch(item.key, { stage: "processing", error: null });
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
    const pending = items.filter((x) => x.photoId && ["received", "processing", "storing", "finding-faces"].includes(x.stage));
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
