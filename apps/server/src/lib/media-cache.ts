import { config } from "../config.js";

/*
 * Size-capped LRU of thumbnail/preview bytes fetched from Drive/MEGA, so a
 * gallery that's scrolled back and forth doesn't re-download every tile.
 * Memory only — it starts empty after a restart.
 */

const MAX_BYTES = config.MEDIA_CACHE_MB * 1024 * 1024;
const MAX_ENTRY = 8 * 1024 * 1024;
const entries = new Map<string, Buffer>();
let total = 0;

export function cacheGet(key: string): Buffer | undefined {
  const hit = entries.get(key);
  if (hit) {
    // Re-insert to mark as most recently used.
    entries.delete(key);
    entries.set(key, hit);
  }
  return hit;
}

export function cacheSet(key: string, value: Buffer) {
  if (!MAX_BYTES || value.length > MAX_ENTRY) return;
  cacheDelete(key);
  entries.set(key, value);
  total += value.length;
  for (const [k, v] of entries) {
    if (total <= MAX_BYTES) break;
    entries.delete(k);
    total -= v.length;
  }
}

export function cacheDelete(key: string) {
  const old = entries.get(key);
  if (old) {
    entries.delete(key);
    total -= old.length;
  }
}

export const mediaKey = (photoId: string, variant: "thumb" | "preview") => `${photoId}:${variant}`;

/*
 * Hand-off for a just-uploaded original: the upload request already holds the
 * bytes, so the ingest job (same process, moments later) takes them from here
 * instead of downloading them back from storage. Bounded and short-lived; on
 * a miss the job simply downloads.
 */
const STASH_TTL_MS = 5 * 60 * 1000;
const STASH_MAX_BYTES = 512 * 1024 * 1024;
const stash = new Map<string, { data: Buffer; at: number }>();
let stashBytes = 0;

export function stashOriginal(photoId: string, data: Buffer) {
  const now = Date.now();
  for (const [k, v] of stash) {
    if (now - v.at < STASH_TTL_MS && stashBytes + data.length <= STASH_MAX_BYTES) break;
    stash.delete(k);
    stashBytes -= v.data.length;
  }
  if (stashBytes + data.length > STASH_MAX_BYTES) return;
  stash.set(photoId, { data, at: now });
  stashBytes += data.length;
}

export function takeOriginal(photoId: string): Buffer | undefined {
  const hit = stash.get(photoId);
  if (!hit) return undefined;
  stash.delete(photoId);
  stashBytes -= hit.data.length;
  return Date.now() - hit.at < STASH_TTL_MS ? hit.data : undefined;
}
