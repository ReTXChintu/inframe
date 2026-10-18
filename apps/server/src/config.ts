import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/src (or dist) → repo root
export const repoRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z.string().min(16, "ENCRYPTION_KEY must be at least 16 characters"),
  MEDIA_SECRET: z.string().min(16, "MEDIA_SECRET must be at least 16 characters"),
  /** In-memory cache for thumbnails/previews fetched from storage (nothing is written to disk). */
  MEDIA_CACHE_MB: z.coerce.number().int().min(0).default(256),
  /** Development only: an in-memory fake storage account for trying InFrame without Drive/MEGA. */
  DEV_MEMORY_STORAGE: bool,

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

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  SYNC_CRON: z.string().default("*/15 * * * *"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
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

export const config = {
  ...env,
  isProd,
  /** Served over HTTPS? Decides the Secure cookie flag (plain http://IP:port hosting must not set it). */
  httpsApp: env.APP_URL.startsWith("https://"),
  devMemoryStorage: env.DEV_MEMORY_STORAGE && !isProd,
  appUrl: env.APP_URL.replace(/\/$/, ""),
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  webDist: path.join(repoRoot, "apps/web/dist"),
};
