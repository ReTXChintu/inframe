import { config } from "../config.js";
import { query, tx } from "../db/pool.js";
import { decryptJson, encryptJson } from "../lib/crypto.js";

/*
 * Runtime settings the super admin manages in Admin → Settings. Each value
 * resolves as: database row → .env → built-in default, and is read from an
 * in-memory snapshot that's refreshed whenever the admin saves. So changes
 * apply immediately, without a restart.
 */

interface Def {
  env: unknown;
  fallback: string | number | boolean | null;
  secret?: boolean;
  type: "string" | "number" | "boolean";
}

const DEFS = {
  "google.clientId": { env: config.GOOGLE_CLIENT_ID, fallback: null, type: "string" },
  "google.clientSecret": { env: config.GOOGLE_CLIENT_SECRET, fallback: null, type: "string", secret: true },
  "smtp.host": { env: config.SMTP_HOST, fallback: null, type: "string" },
  "smtp.port": { env: config.SMTP_PORT, fallback: 587, type: "number" },
  "smtp.secure": { env: config.SMTP_SECURE, fallback: false, type: "boolean" },
  "smtp.user": { env: config.SMTP_USER, fallback: null, type: "string" },
  "smtp.pass": { env: config.SMTP_PASS, fallback: null, type: "string", secret: true },
  "smtp.from": { env: config.MAIL_FROM, fallback: "InFrame <no-reply@localhost>", type: "string" },
  "model.url": { env: config.MODEL_URL, fallback: null, type: "string" },
  "model.apiKey": { env: config.MODEL_API_KEY, fallback: null, type: "string", secret: true },
  "model.apiKeyHeader": { env: config.MODEL_API_KEY_HEADER, fallback: "x-api-key", type: "string" },
  "model.timeoutMs": { env: config.MODEL_TIMEOUT_MS, fallback: 60_000, type: "number" },
  "model.matchThreshold": { env: config.MATCH_THRESHOLD, fallback: 0.5, type: "number" },
} satisfies Record<string, Def>;

export type SettingKey = keyof typeof DEFS;
export const SETTING_KEYS = Object.keys(DEFS) as SettingKey[];
export const isSecret = (key: SettingKey) => Boolean((DEFS[key] as Def).secret);

type Value = string | number | boolean | null;
let stored = new Map<SettingKey, Value>();
let listeners: (() => void)[] = [];

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

function coerce(key: SettingKey, raw: string): Value {
  const type = DEFS[key].type;
  if (type === "number") return Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}

/** Load the database rows into memory. Called at boot and after every save. */
export async function loadSettings() {
  const rows = await query<{ key: SettingKey; value: string; is_secret: boolean }>("SELECT key, value, is_secret FROM app_settings");
  const next = new Map<SettingKey, Value>();
  for (const r of rows) {
    if (!(r.key in DEFS)) continue;
    try {
      next.set(r.key, coerce(r.key, r.is_secret ? decryptJson<string>(r.value) : r.value));
    } catch {
      // Undecryptable (ENCRYPTION_KEY changed): behave as if unset.
    }
  }
  stored = next;
  for (const fn of listeners) fn();
}

/** Run `fn` whenever settings change (e.g. to rebuild an SMTP transport). */
export function onSettingsChange(fn: () => void) {
  listeners.push(fn);
}

export type Source = "admin" | "env" | "default";

export function source(key: SettingKey): Source {
  if (stored.has(key)) return "admin";
  return present(DEFS[key].env) ? "env" : "default";
}

export function setting<K extends SettingKey>(key: K): Value {
  if (stored.has(key)) return stored.get(key)!;
  const env = DEFS[key].env;
  return present(env) ? (env as Value) : DEFS[key].fallback;
}

const str = (key: SettingKey) => {
  const v = setting(key);
  return present(v) ? String(v) : null;
};

// ─── Typed views used by the rest of the server ──────────────────────────
export function googleSettings() {
  const clientId = str("google.clientId");
  const clientSecret = str("google.clientSecret");
  return {
    clientId,
    clientSecret,
    enabled: Boolean(clientId && clientSecret),
    redirectUri: `${config.appUrl}/api/storage/google/callback`,
  };
}

export function smtpSettings() {
  return {
    host: str("smtp.host"),
    port: Number(setting("smtp.port")) || 587,
    secure: setting("smtp.secure") === true,
    user: str("smtp.user"),
    pass: str("smtp.pass"),
    from: str("smtp.from") ?? "InFrame <no-reply@localhost>",
  };
}

export function modelSettings() {
  return {
    url: str("model.url"),
    apiKey: str("model.apiKey"),
    apiKeyHeader: str("model.apiKeyHeader") ?? "x-api-key",
    timeoutMs: Number(setting("model.timeoutMs")) || 60_000,
    matchThreshold: Number(setting("model.matchThreshold")) || 0.5,
  };
}

/**
 * Apply an admin's changes. `undefined` leaves a key as it is; `null` removes
 * the admin override (falling back to .env / default); anything else is saved.
 */
export async function saveSettings(changes: Partial<Record<SettingKey, Value | undefined>>, userId: string) {
  await tx(async (db) => {
    for (const key of SETTING_KEYS) {
      const value = changes[key];
      if (value === undefined) continue;
      if (value === null) {
        await db.query("DELETE FROM app_settings WHERE key = $1", [key]);
        continue;
      }
      const secret = isSecret(key);
      const text = String(value);
      await db.query(
        `INSERT INTO app_settings (key, value, is_secret, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret,
                                         updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, secret ? encryptJson(text) : text, secret, userId],
      );
    }
  });
  await loadSettings();
}
