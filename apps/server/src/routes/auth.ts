import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { one, query, tx } from "../db/pool.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { AppError, badRequest, conflict, parse, unauthorized } from "../lib/errors.js";
import { sendMail } from "../lib/mailer.js";
import {
  endSession,
  hashPassword,
  REFRESH_COOKIE,
  rotateSession,
  signAccessToken,
  startSession,
  verifyPassword,
} from "../auth/tokens.js";
import { email, password, personName } from "./shared.js";

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  token_version: number;
  is_admin: boolean;
  created_at: Date;
}

export const serializeUser = (u: Pick<UserRow, "id" | "email" | "name" | "created_at" | "is_admin">) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isAdmin: u.is_admin,
  createdAt: u.created_at,
});

async function issue(reply: FastifyReply, user: UserRow) {
  return { accessToken: await signAccessToken(user.id, user.token_version), user: serializeUser(user) };
}

// Brute-force protection on everything that takes a password or sends mail.
const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/signup", strict, async (req, reply) => {
    const body = parse(z.object({ name: personName, email, password }), req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await tx(async (db) => {
      // The very first account becomes the super admin. The lock makes two
      // simultaneous first sign-ups queue up, so only one of them gets it.
      await db.query("SELECT pg_advisory_xact_lock(727002)");
      const created = await one<UserRow>(
        `INSERT INTO users (email, name, password_hash, is_admin)
         VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM users))
         ON CONFLICT (email) DO NOTHING RETURNING *`,
        [body.email, body.name, passwordHash],
        db,
      );
      if (!created) throw conflict("An account with this email already exists. Try signing in.");
      // Every account gets its own "self" person, enrolled later with a selfie.
      await db.query("INSERT INTO people (owner_id, kind, name) VALUES ($1, 'self', $2)", [created.id, body.name]);
      await startSession(reply, created.id, req.headers["user-agent"], db);
      return created;
    });
    reply.code(201);
    return issue(reply, user);
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().min(1, "Enter your password.") }), req.body);
    const user = await one<UserRow>("SELECT * FROM users WHERE email = $1", [body.email]);
    // Same message for unknown email and wrong password.
    if (!user || !(await verifyPassword(user.password_hash, body.password))) {
      throw new AppError(401, "invalid_credentials", "That email and password don't match.");
    }
    await startSession(reply, user.id, req.headers["user-agent"]);
    return issue(reply, user);
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    const userId = token ? await rotateSession(reply, token, req.headers["user-agent"]) : null;
    const user = userId ? await one<UserRow>("SELECT * FROM users WHERE id = $1", [userId]) : undefined;
    if (!user) {
      reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      throw unauthorized("Your session has ended. Please sign in again.");
    }
    return issue(reply, user);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await endSession(reply, req.cookies[REFRESH_COOKIE]);
    return { ok: true };
  });

  app.post("/api/auth/forgot-password", strict, async (req) => {
    const body = parse(z.object({ email }), req.body);
    const user = await one<UserRow>("SELECT * FROM users WHERE email = $1", [body.email]);
    // Always the same answer, so this can't be used to find out who has an account.
    if (user) {
      const token = randomToken();
      await query("DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL", [user.id]);
      await query(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [user.id, sha256(token)],
      );
      await sendMail({
        to: user.email,
        subject: "Reset your InFrame password",
        lines: [
          `Hi ${user.name},`,
          "Someone (hopefully you) asked to reset the password for your InFrame account. This link works for one hour.",
          "If it wasn't you, ignore this email — your password stays the same.",
        ],
        action: { label: "Choose a new password", url: `${config.appUrl}/reset-password?token=${token}` },
      });
    }
    return { ok: true };
  });

  app.post("/api/auth/reset-password", strict, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10), password }), req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await tx(async (db) => {
      const reset = await one<{ user_id: string }>(
        `UPDATE password_resets SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [sha256(body.token)],
        db,
      );
      if (!reset) throw badRequest("This reset link has expired or was already used. Ask for a new one.");
      // New password signs out every other device.
      const updated = await one<UserRow>(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [reset.user_id, passwordHash],
        db,
      );
      await db.query("DELETE FROM sessions WHERE user_id = $1", [reset.user_id]);
      await startSession(reply, reset.user_id, req.headers["user-agent"], db);
      return updated!;
    });
    return issue(reply, user);
  });
}
