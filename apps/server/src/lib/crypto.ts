import crypto from "node:crypto";
import { config } from "../config.js";

const encKey = crypto.createHash("sha256").update(`enc:${config.ENCRYPTION_KEY}`).digest();

/** AES-256-GCM. Output: base64url(iv | tag | ciphertext). */
export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function decryptJson<T>(payload: string): T {
  const buf = Buffer.from(payload, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const text = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// No 0/O, 1/I/L — codes get read aloud and typed from posters.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 8 characters ≈ 8.5e11 combinations; shown to people as XXXX-XXXX. */
export function joinCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const mediaKey = crypto.createHash("sha256").update(`media:${config.MEDIA_SECRET}`).digest();

export function hmac(value: string): string {
  return crypto.createHmac("sha256", mediaKey).update(value).digest("base64url").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
