import { hmac, safeEqual } from "./crypto.js";

export type PhotoVariant = "thumb" | "preview" | "original";

// URLs expire on fixed 6-hour boundaries (valid for 6–12h), so the same
// photo gets the same URL for a while and the browser cache keeps working.
const BUCKET_MS = 6 * 60 * 60 * 1000;

function expiry(): number {
  return Math.ceil(Date.now() / BUCKET_MS) * BUCKET_MS + BUCKET_MS;
}

function sign(scope: string, exp: number) {
  return hmac(`${scope}:${exp}`);
}

export function photoUrl(photoId: string, variant: PhotoVariant): string {
  const exp = expiry();
  return `/media/p/${photoId}/${variant}?e=${exp}&s=${sign(`p:${photoId}:${variant}`, exp)}`;
}

export function selfieUrl(personId: string, version: string | Date | null): string {
  const exp = expiry();
  const v = version ? new Date(version).getTime() : 0;
  return `/media/s/${personId}?v=${v}&e=${exp}&s=${sign(`s:${personId}`, exp)}`;
}

export function verifyMedia(scope: string, e: unknown, s: unknown): boolean {
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now() || typeof s !== "string") return false;
  return safeEqual(sign(scope, exp), s);
}
