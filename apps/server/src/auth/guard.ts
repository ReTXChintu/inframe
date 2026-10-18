import type { FastifyRequest } from "fastify";
import { one } from "../db/pool.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "./tokens.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

/** Resolves a bearer access token to a live user (null when missing, bad, or revoked). */
export async function userFromToken(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const user = await one<{ id: string; email: string; name: string; is_admin: boolean; token_version: number }>(
    "SELECT id, email, name, is_admin, token_version FROM users WHERE id = $1",
    [claims.userId],
  );
  if (!user || user.token_version !== claims.tokenVersion) return null;
  return { id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin };
}

/** Fastify preHandler: 401 unless the request carries a valid access token. */
export async function requireUser(req: FastifyRequest) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await userFromToken(token);
  if (!user) throw unauthorized();
  req.user = user;
}

/** preHandler for admin-only routes (checked against the database on every request). */
export async function requireAdmin(req: FastifyRequest) {
  await requireUser(req);
  if (!req.user.isAdmin) throw forbidden("Only the admin can do that.");
}
