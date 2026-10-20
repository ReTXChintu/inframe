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
