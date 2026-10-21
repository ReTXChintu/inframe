import crypto from "node:crypto";
import { safeEqual } from "../lib/crypto.js";

/*
 * Service-to-service calls inside the suite (Trippin → InFrame) carry no user
 * token. Instead the caller signs `${timestamp}.${rawBody}` with a secret both
 * sides share:
 *
 *   x-suite-timestamp: <unix seconds>
 *   x-suite-signature: sha256=<hex HMAC-SHA256>
 *
 * A GET signs the empty body. Timestamps more than five minutes away from our
 * clock are refused, so a captured request can't be replayed later.
 */

export const SUITE_MAX_SKEW_S = 5 * 60;

export function suiteSignature(secret: string, timestamp: string, rawBody: string | Buffer) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`;
}

export type SuiteCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verifySuiteSignature(opts: {
  secret: string;
  timestamp: unknown;
  signature: unknown;
  rawBody: string | Buffer;
  now?: number;
}): SuiteCheck {
  const { secret, timestamp, signature } = opts;
  if (typeof timestamp !== "string" || typeof signature !== "string" || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "missing" };
  }
  const nowS = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(nowS - Number(timestamp)) > SUITE_MAX_SKEW_S) return { ok: false, reason: "stale" };
  // Constant-time compare (safeEqual checks the length first, which leaks nothing secret).
  if (!safeEqual(suiteSignature(secret, timestamp, opts.rawBody), signature.trim().toLowerCase())) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
