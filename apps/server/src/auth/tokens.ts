import { SignJWT, jwtVerify } from "jose";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { FastifyReply } from "fastify";
import { config } from "../config.js";
import { one, query, type Queryable } from "../db/pool.js";
import { randomToken, sha256 } from "../lib/crypto.js";

const jwtKey = new TextEncoder().encode(config.JWT_SECRET);
const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 30;
export const REFRESH_COOKIE = "inframe_rt";

export const hashPassword = (password: string) => argonHash(password);
export const verifyPassword = (hash: string, password: string) => argonVerify(hash, password).catch(() => false);

export async function signAccessToken(userId: string, tokenVersion: number) {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(jwtKey);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; tokenVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.tv !== "number") return null;
    return { userId: payload.sub, tokenVersion: payload.tv };
  } catch {
    return null;
  }
}

/** Short-lived signed blobs (OAuth state, etc.). */
export async function signState(data: Record<string, unknown>, ttl = "15m") {
  return new SignJWT(data).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(ttl).sign(jwtKey);
}

export async function verifyState<T>(token: string): Promise<T | null> {
  try {
    return (await jwtVerify(token, jwtKey, { algorithms: ["HS256"] })).payload as T;
  } catch {
    return null;
  }
}

/** Creates a session row and sets the httpOnly refresh cookie. */
export async function startSession(reply: FastifyReply, userId: string, userAgent?: string, db?: Queryable) {
  const token = randomToken();
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, sha256(token), userAgent?.slice(0, 300) ?? null, REFRESH_TTL_DAYS],
    db,
  );
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Browsers drop Secure cookies on plain http://, which would sign people out on every reload.
    secure: config.httpsApp,
    path: "/api/auth",
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
  });
}

/** Single-use: the presented refresh token is deleted and a new one issued. */
export async function rotateSession(reply: FastifyReply, token: string, userAgent?: string) {
  const session = await one<{ user_id: string }>(
    "DELETE FROM sessions WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
    [sha256(token)],
  );
  if (!session) return null;
  await startSession(reply, session.user_id, userAgent);
  return session.user_id;
}

export async function endSession(reply: FastifyReply, token: string | undefined) {
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}
