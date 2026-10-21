import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src (or dist) → repo root
export const repoRoot = path.resolve(here, "../../..");
// Tests configure everything through process.env and must not pick up a developer's .env.
if (process.env.NODE_ENV !== "test") dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().default(4000),
  /**
   * Serve HTTPS directly, with no proxy in front: the certificate and key
   * files (e.g. Let's Encrypt's fullchain.pem and privkey.pem). Both or
   * neither; without them the server speaks plain HTTP.
   */
  SSL_CERT_PATH: z.string().optional(),
  SSL_KEY_PATH: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be at least 16 characters"),
  MEDIA_SECRET: z.string().min(16, "MEDIA_SECRET must be at least 16 characters"),
  /** In-memory cache for thumbnails/previews fetched from storage (nothing is written to disk). */
  MEDIA_CACHE_MB: z.coerce.number().int().min(0).default(256),
  /** Development only: an in-memory fake storage account for trying InFrame without Drive/MEGA. */
  DEV_MEMORY_STORAGE: bool,

  // Sign-in: the OpenID Connect identity server shared with SpendLog and Trippin.
  // InFrame has no passwords of its own; the identity server proves who someone is.
  OIDC_ISSUER: z.string().url().optional(),
  /** The web app's (confidential) client. */
  OIDC_CLIENT_ID: z.string().default("inframe-web"),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /** Default: <APP_URL>/api/auth/oidc/callback */
  OIDC_REDIRECT_URI: z.string().url().optional(),
  /** Where the identity server sends people after signing out. Default: <APP_URL>/login */
  OIDC_POST_LOGOUT_URI: z.string().url().optional(),
  /** The Android app's (public, PKCE) client: its ID tokens carry this audience. */
  OIDC_MOBILE_CLIENT_ID: z.string().default("inframe-mobile"),

  // Model, Google and SMTP values are optional here: the super admin can set
  // (and override) all of them in Admin → Settings.
  MODEL_URL: z.string().url().optional(),
  MODEL_API_KEY: z.string().optional(),
  MODEL_API_KEY_HEADER: z.string().optional(),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  MATCH_THRESHOLD: z.coerce.number().min(0).max(1).optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  /** Parallel jobs per worker process (storing uploads, thumbnails, face scans). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  /** Which queues a worker process serves (comma list). Default: all of them. */
  WORKER_QUEUES: z.string().default("store,faces,sync"),
  /** Also run the workers inside the API process (single-process setups). Default: separate `worker` process. */
  RUN_WORKERS_IN_API: bool,
  SYNC_CRON: z.string().default("*/15 * * * *"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  MAX_VIDEO_MB: z.coerce.number().int().positive().default(4096),
  /**
   * Where uploads wait between "received from the phone/browser" and "stored
   * in Drive/MEGA". Files are deleted as soon as they're stored.
   */
  SPOOL_DIR: z.string().optional(),
});

const parsed = schema.safeParse(
  // Treat empty strings in .env as "not set" so defaults and optionals apply.
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid configuration in ${path.join(repoRoot, ".env")}:\n${lines.join("\n")}`);
  process.exit(1);
}

const env = parsed.data;
const isProd = env.NODE_ENV === "production";
if (isProd && env.DEV_MEMORY_STORAGE) {
  console.error("DEV_MEMORY_STORAGE can't be used in production — it keeps photos only in memory.");
  process.exit(1);
}

const appUrl = env.APP_URL.replace(/\/$/, "");

export const config = {
  ...env,
  isProd,
  oidc: {
    issuer: env.OIDC_ISSUER ?? null,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET ?? null,
    redirectUri: env.OIDC_REDIRECT_URI ?? `${appUrl}/api/auth/oidc/callback`,
    postLogoutUri: env.OIDC_POST_LOGOUT_URI ?? `${appUrl}/login`,
    mobileClientId: env.OIDC_MOBILE_CLIENT_ID,
  },
  /** Served over HTTPS? Decides the Secure cookie flag (plain http://IP:port hosting must not set it). */
  httpsApp: env.APP_URL.startsWith("https://"),
  devMemoryStorage: env.DEV_MEMORY_STORAGE && !isProd,
  // Memory storage lives in one process, so its workers must run inside the API.
  runWorkersInApi: env.RUN_WORKERS_IN_API || (env.DEV_MEMORY_STORAGE && !isProd),
  appUrl,
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  maxVideoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
  spoolDir: env.SPOOL_DIR ? path.resolve(repoRoot, env.SPOOL_DIR) : path.join(os.tmpdir(), "inframe-spool"),
  workerQueues: new Set(env.WORKER_QUEUES.split(",").map((q) => q.trim()).filter(Boolean)),
  webDist: path.join(repoRoot, "apps/web/dist"),
};
