import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { z } from "zod";
import { requireAdmin } from "../auth/guard.js";
import { one } from "../db/pool.js";
import { AppError, parse } from "../lib/errors.js";
import { testModel } from "../model/client.js";
import {
  googleSettings,
  isSecret,
  saveSettings,
  setting,
  SETTING_KEYS,
  source,
  type SettingKey,
} from "../services/settings.js";

/*
 * Super-admin settings. Secrets (Google client secret, SMTP password, model
 * API key) are write-only: the API reports whether one is set, never its value.
 * In a save, a key that's left out is unchanged, and `null` removes the admin's
 * value so the .env value (or the default) applies again.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const settingsBody = z
  .object({
    "google.clientId": optionalText(300),
    "google.clientSecret": optionalText(300),
    "smtp.host": optionalText(255),
    "smtp.port": z.coerce.number().int().min(1).max(65535).nullable().optional(),
    "smtp.secure": z.boolean().nullable().optional(),
    "smtp.user": optionalText(255),
    "smtp.pass": optionalText(500),
    "smtp.from": optionalText(255),
    "model.url": z
      .string()
      .trim()
      .url("Enter a full URL, like https://faces.example.com")
      .refine((u) => /^https?:\/\//.test(u), "Use an http:// or https:// URL.")
      .nullable()
      .optional(),
    "model.apiKey": optionalText(500),
    "model.apiKeyHeader": z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,64}$/, "Use a plain header name, like x-api-key.")
      .nullable()
      .optional(),
    "model.timeoutMs": z.coerce.number().int().min(1000, "At least 1 second.").max(300_000, "At most 5 minutes.").nullable().optional(),
    "model.matchThreshold": z.coerce.number().min(0.2, "Use 0.20 or higher.").max(0.95, "Use 0.95 or lower.").nullable().optional(),
  })
  .strict();

type Body = z.infer<typeof settingsBody>;

/** An empty text box means "clear my value" for plain fields; for secrets it means "keep". */
function normalize(body: Body) {
  const out: Partial<Record<SettingKey, string | number | boolean | null | undefined>> = {};
  for (const key of SETTING_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === "") out[key] = isSecret(key) ? undefined : null;
    else out[key] = v;
  }
  return out;
}

function snapshot() {
  const settings: Record<string, { value: unknown; set: boolean; source: string }> = {};
  for (const key of SETTING_KEYS) {
    const value = setting(key);
    const set = value !== null && value !== undefined && value !== "";
    settings[key] = { value: isSecret(key) ? null : value, set, source: source(key) };
  }
  return { settings, googleRedirectUri: googleSettings().redirectUri };
}

/** Saved value unless the draft overrides it (used to test before saving). */
function draftValue(draft: ReturnType<typeof normalize>, key: SettingKey) {
  const v = draft[key];
  return v === undefined || v === null ? setting(key) : v;
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/overview", async () => {
    const counts = await one(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM events) AS events,
              (SELECT count(*)::int FROM photos WHERE status = 'ready') AS photos,
              (SELECT count(*)::int FROM faces) AS faces,
              (SELECT count(*)::int FROM photos WHERE status = 'failed' OR face_status = 'failed') AS failed,
              (SELECT count(*)::int FROM storage_connections) AS connections`,
    );
    return { counts };
  });

  app.get("/api/admin/settings", async () => snapshot());

  app.put("/api/admin/settings", async (req) => {
    const changes = normalize(parse(settingsBody, req.body));
    await saveSettings(changes, req.user.id);
    req.log.info({ keys: Object.keys(changes), by: req.user.id }, "admin settings updated");
    return snapshot();
  });

  /** Send a test email with the form's values (unsaved ones included). */
  app.post("/api/admin/settings/test-email", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(settingsBody.extend({ to: z.string().trim().email().optional() }), req.body ?? {});
    const { to, ...rest } = body;
    const draft = normalize(rest);
    const host = draftValue(draft, "smtp.host");
    if (!host) throw new AppError(400, "smtp", "Enter an SMTP host first.");
    const user = draftValue(draft, "smtp.user");
    const transport = nodemailer.createTransport({
      host: String(host),
      port: Number(draftValue(draft, "smtp.port")) || 587,
      secure: draftValue(draft, "smtp.secure") === true,
      auth: user ? { user: String(user), pass: String(draftValue(draft, "smtp.pass") ?? "") } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
    });
    try {
      await transport.verify();
      await transport.sendMail({
        from: String(draftValue(draft, "smtp.from") ?? "InFrame <no-reply@localhost>"),
        to: to ?? req.user.email,
        subject: "InFrame test email",
        text: "If you can read this, InFrame can send password-reset and invite emails.",
      });
      return { ok: true, to: to ?? req.user.email };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      transport.close();
    }
  });

  /** Call the face model's /extract with the form's values (unsaved ones included). */
  app.post("/api/admin/settings/test-model", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const draft = normalize(parse(settingsBody, req.body ?? {}));
    const url = draftValue(draft, "model.url");
    if (!url) throw new AppError(400, "model", "Enter the model URL first.");
    const apiKey = draftValue(draft, "model.apiKey");
    return testModel({
      url: String(url),
      apiKey: apiKey ? String(apiKey) : null,
      apiKeyHeader: String(draftValue(draft, "model.apiKeyHeader") ?? "x-api-key"),
      timeoutMs: Number(draftValue(draft, "model.timeoutMs")) || 60_000,
    });
  });
}
