import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { one, tx } from "../db/pool.js";
import { safeEqual } from "../lib/crypto.js";
import { AppError, badRequest, parse, unauthorized } from "../lib/errors.js";
import {
  endSession,
  isMobileClient,
  presentedRefreshToken,
  REFRESH_COOKIE,
  rotateSession,
  signAccessToken,
  signState,
  startSession,
  verifyState,
} from "../auth/tokens.js";
import {
  authorizationUrl,
  endSessionUrl,
  exchangeCode,
  oidcRandom,
  pkcePair,
  verifyIdToken,
  type IdentityClaims,
} from "../auth/oidc.js";

interface UserRow {
  id: string;
  email: string;
  name: string;
  oidc_sub: string | null;
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

/** Tokens for the client. The refresh token goes in the body only for the mobile app (browsers keep it in the cookie). */
async function issue(req: FastifyRequest, user: UserRow, refreshToken: string) {
  return {
    accessToken: await signAccessToken(user.id, user.token_version),
    ...(isMobileClient(req) ? { refreshToken } : {}),
    user: serializeUser(user),
  };
}

/**
 * The local account for someone the identity server vouched for:
 *   1. the account already linked to their `sub`;
 *   2. else an existing account with the same email — linked only when the
 *      identity server says the email is verified;
 *   3. else a new account, set up the way sign-up always did it.
 */
export async function userFromIdentity(claims: IdentityClaims): Promise<{ user: UserRow; created: boolean }> {
  return tx(async (db) => {
    // The very first account becomes the super admin. The lock makes two
    // simultaneous first sign-ins queue up, so only one of them gets it (and
    // two sign-ins for one person can't both link or create).
    await db.query("SELECT pg_advisory_xact_lock(727002)");

    const linked = await one<UserRow>("SELECT * FROM users WHERE oidc_sub = $1", [claims.sub], db);
    if (linked) {
      // Follow an email change made at the identity server, once it's verified (invites are matched by email).
      if (claims.emailVerified && linked.email.toLowerCase() !== claims.email) {
        const updated = await one<UserRow>(
          `UPDATE users SET email = $2, updated_at = now()
            WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE email = $2 AND id <> $1)
            RETURNING *`,
          [linked.id, claims.email],
          db,
        );
        return { user: updated ?? linked, created: false };
      }
      return { user: linked, created: false };
    }

    // An unverified address could belong to anyone: it neither claims an
    // existing account nor starts one (it would receive that email's invites).
    if (!claims.emailVerified) {
      throw new AppError(403, "email_unverified", "Verify your email address with your account first, then sign in again.");
    }

    const byEmail = await one<UserRow>("SELECT * FROM users WHERE email = $1", [claims.email], db);
    if (byEmail) {
      if (byEmail.oidc_sub) throw new AppError(409, "email_taken", "This email already belongs to a different InFrame account.");
      const user = await one<UserRow>(
        "UPDATE users SET oidc_sub = $2, updated_at = now() WHERE id = $1 RETURNING *",
        [byEmail.id, claims.sub],
        db,
      );
      return { user: user!, created: false };
    }

    const name = (claims.name ?? claims.email.split("@")[0] ?? "").trim().slice(0, 80) || "InFrame user";
    const created = await one<UserRow>(
      `INSERT INTO users (email, name, oidc_sub, is_admin)
       VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM users)) RETURNING *`,
      [claims.email, name, claims.sub],
      db,
    );
    // Every account gets its own "self" person, enrolled later with a selfie.
    await db.query("INSERT INTO people (owner_id, kind, name) VALUES ($1, 'self', $2)", [created!.id, name]);
    return { user: created!, created: true };
  });
}

/** Only an in-app path is a valid place to land after signing in. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return "/";
  // Not "//host" or "/\host" (protocol-relative), no control characters.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return "/";
  return value;
}

/** The signed-in-progress cookie: state, nonce and PKCE verifier between /start and /callback. */
const OIDC_COOKIE = "inframe_oidc";
const OIDC_COOKIE_PATH = "/api/auth/oidc";
const OIDC_COOKIE_TTL_S = 10 * 60;

interface PendingSignIn {
  typ: "oidc";
  /** state */
  s: string;
  /** nonce */
  n: string;
  /** PKCE code verifier */
  v: string;
  /** returnTo */
  r: string;
}

function loginUrl(error: string, returnTo: string) {
  const next = returnTo !== "/" ? `&next=${encodeURIComponent(returnTo)}` : "";
  return `${config.appUrl}/login?error=${encodeURIComponent(error)}${next}`;
}

// Brute-force protection on everything that signs someone in.
const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
const redirects = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  // ─── Web: authorization code + PKCE through the identity server ─────────
  app.get("/api/auth/oidc/start", redirects, async (req, reply) => {
    const returnTo = safeReturnTo((req.query as { returnTo?: unknown }).returnTo);
    const { verifier, challenge } = pkcePair();
    const pending: PendingSignIn = { typ: "oidc", s: oidcRandom(), n: oidcRandom(), v: verifier, r: returnTo };
    let url: string;
    try {
      url = await authorizationUrl({ state: pending.s, nonce: pending.n, codeChallenge: challenge });
    } catch (err) {
      if (err instanceof AppError) return reply.redirect(loginUrl(err.code, returnTo));
      throw err;
    }
    reply.setCookie(OIDC_COOKIE, await signState({ ...pending }, `${OIDC_COOKIE_TTL_S}s`), {
      httpOnly: true,
      // Lax: the identity server's redirect back is a top-level GET, which still carries it.
      sameSite: "lax",
      secure: config.httpsApp,
      path: OIDC_COOKIE_PATH,
      maxAge: OIDC_COOKIE_TTL_S,
    });
    return reply.redirect(url);
  });

  app.get("/api/auth/oidc/callback", redirects, async (req, reply: FastifyReply) => {
    const q = req.query as Record<string, unknown>;
    const raw = req.cookies[OIDC_COOKIE];
    reply.clearCookie(OIDC_COOKIE, { path: OIDC_COOKIE_PATH });
    const pending = raw ? await verifyState<PendingSignIn>(raw) : null;
    const returnTo = safeReturnTo(pending?.r);
    const fail = (code: string) => reply.redirect(loginUrl(code, returnTo));

    if (typeof q.error === "string") return fail(q.error === "access_denied" ? "cancelled" : "sso_failed");
    // A missing/expired cookie or a state that isn't ours: started elsewhere, replayed, or forged.
    if (pending?.typ !== "oidc" || typeof q.state !== "string" || !safeEqual(q.state, pending.s)) return fail("expired");
    if (typeof q.code !== "string" || !q.code) return fail("sso_failed");

    try {
      const claims = await exchangeCode(q.code, pending.v, pending.n);
      const { user, created } = await userFromIdentity(claims);
      await startSession(reply, user.id, req.headers["user-agent"]);
      // New accounts go to People first to add a selfie, unless they came from a join or invite link.
      const dest = created && returnTo === "/" ? "/people?welcome=1" : returnTo;
      return reply.redirect(`${config.appUrl}${dest}`);
    } catch (err) {
      if (err instanceof AppError) {
        req.log.warn({ code: err.code, reason: (err as { reason?: string }).reason }, "sign-in through the identity server failed");
        return fail(err.code);
      }
      throw err;
    }
  });

  // ─── Mobile: the app ran the flow itself and brings the ID token ────────
  app.post("/api/auth/oidc/mobile", strict, async (req, reply) => {
    if (!isMobileClient(req)) throw badRequest("This sign-in is only for the InFrame app.");
    const body = parse(
      z.object({ idToken: z.string().min(20, "Missing ID token.").max(20_000), nonce: z.string().max(500).optional() }),
      req.body,
    );
    let claims: IdentityClaims;
    try {
      claims = await verifyIdToken(body.idToken, { audience: config.oidc.mobileClientId, nonce: body.nonce, maxAge: "10m" });
    } catch (err) {
      if (err instanceof AppError) req.log.warn({ code: err.code, reason: (err as { reason?: string }).reason }, "mobile sign-in refused");
      throw err;
    }
    const { user, created } = await userFromIdentity(claims);
    const refreshToken = await startSession(reply, user.id, req.headers["user-agent"]);
    if (created) reply.code(201);
    return { ...(await issue(req, user, refreshToken)), created };
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const token = presentedRefreshToken(req);
    const rotated = token ? await rotateSession(reply, token, req.headers["user-agent"]) : null;
    const user = rotated ? await one<UserRow>("SELECT * FROM users WHERE id = $1", [rotated.userId]) : undefined;
    if (!rotated || !user) {
      reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      throw unauthorized("Your session has ended. Please sign in again.");
    }
    return issue(req, user, rotated.refreshToken);
  });

  /**
   * Ends this InFrame session. Browsers then go to `endSessionUrl` so the
   * identity server signs them out too (the app calls its own end-session).
   */
  app.post("/api/auth/logout", async (req, reply) => {
    await endSession(reply, presentedRefreshToken(req));
    return { ok: true, endSessionUrl: isMobileClient(req) ? null : await endSessionUrl() };
  });
}
