import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { randomToken } from "../lib/crypto.js";

/*
 * InFrame signs people in through the OpenID Connect identity server shared
 * with SpendLog and Trippin. It only proves identity at sign-in: after that
 * InFrame runs on its own access/refresh tokens exactly as before.
 *
 *   web:    authorization code + PKCE, confidential client (OIDC_CLIENT_ID)
 *   mobile: the app runs the code flow itself (public client, PKCE) and hands
 *           InFrame the ID token, verified here with the mobile audience.
 */

export const OIDC_SCOPES = "openid email profile offline_access";
const HTTP_TIMEOUT_MS = 10_000;
/** How long a cached discovery document is trusted before it's fetched again. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoverySchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  end_session_endpoint: z.string().url().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
});
type Discovery = z.infer<typeof discoverySchema>;

/**
 * Sign-in through the identity server failed. `reason` is for the server log
 * only (it can describe tokens); people get `message`.
 */
export class OidcError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    public reason?: string,
  ) {
    super(status, code, message);
  }
}

export const oidcConfigured = () => Boolean(config.oidc.issuer);

function requireIssuer(): string {
  if (!config.oidc.issuer) throw new OidcError(503, "sso_not_configured", "Sign-in isn't set up on this server yet.");
  return config.oidc.issuer;
}

const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

let discovery: { doc: Discovery; fetchedAt: number; jwks: JWTVerifyGetKey } | null = null;
let discovering: Promise<Discovery> | null = null;

async function getDiscovery(): Promise<{ doc: Discovery; jwks: JWTVerifyGetKey }> {
  const issuer = requireIssuer();
  if (discovery && Date.now() - discovery.fetchedAt < DISCOVERY_TTL_MS) return discovery;
  discovering ??= (async () => {
    const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (err) {
      throw new OidcError(502, "sso_unavailable", "The sign-in service can't be reached right now. Try again in a minute.", (err as Error).message);
    }
    const parsed = discoverySchema.safeParse(res.ok ? await res.json().catch(() => null) : null);
    if (!parsed.success || !sameIssuer(parsed.data.issuer, issuer)) {
      throw new OidcError(502, "sso_unavailable", "The sign-in service answered with an unexpected configuration.");
    }
    return parsed.data;
  })().finally(() => {
    discovering = null;
  });
  const doc = await discovering;
  // jose's remote key set caches the keys itself and refetches when it meets an unknown key id.
  const jwks = discovery?.doc.jwks_uri === doc.jwks_uri ? discovery.jwks : createRemoteJWKSet(new URL(doc.jwks_uri));
  discovery = { doc, fetchedAt: Date.now(), jwks };
  return discovery;
}

/** Forget the cached discovery document and keys (tests, or after the issuer changed). */
export function resetOidcCache() {
  discovery = null;
  discovering = null;
}

// ─── PKCE / state ────────────────────────────────────────────────────────

export function pkcePair() {
  const verifier = randomToken(32);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }) {
  const { doc } = await getDiscovery();
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.oidc.clientId,
    redirect_uri: config.oidc.redirectUri,
    scope: OIDC_SCOPES,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Web client: trade the authorization code for tokens, and return the verified ID token's claims. */
export async function exchangeCode(code: string, codeVerifier: string, nonce: string): Promise<IdentityClaims> {
  const { doc } = await getDiscovery();
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oidc.redirectUri,
    code_verifier: codeVerifier,
    client_id: config.oidc.clientId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const secret = config.oidc.clientSecret;
  if (secret) {
    const methods = doc.token_endpoint_auth_methods_supported;
    // client_secret_basic is the spec default; fall back to _post only when that's all the server takes.
    if (!methods || methods.includes("client_secret_basic")) {
      const enc = (v: string) => encodeURIComponent(v);
      headers.authorization = `Basic ${Buffer.from(`${enc(config.oidc.clientId)}:${enc(secret)}`).toString("base64")}`;
    } else {
      form.set("client_secret", secret);
    }
  }

  let res: Response;
  try {
    res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OidcError(502, "sso_unavailable", "The sign-in service can't be reached right now. Try again in a minute.", (err as Error).message);
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof body?.id_token !== "string") {
    throw new OidcError(401, "sso_failed", "The sign-in service didn't accept this sign-in. Try again.", typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return verifyIdToken(body.id_token, { audience: config.oidc.clientId, nonce });
}

// ─── ID tokens ───────────────────────────────────────────────────────────

export interface IdentityClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(254),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  nonce: z.string().optional(),
});

/**
 * Verifies an RS256 ID token from the identity server: signature (JWKS),
 * issuer, audience, expiry and, when given, the nonce.
 */
export async function verifyIdToken(
  token: string,
  opts: { audience: string; nonce?: string; maxAge?: string },
): Promise<IdentityClaims> {
  const { doc, jwks } = await getDiscovery();
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: doc.issuer,
      audience: opts.audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
      ...(opts.maxAge ? { maxTokenAge: opts.maxAge } : {}),
    }));
  } catch (err) {
    throw new OidcError(401, "sso_invalid_token", "That sign-in couldn't be verified. Try again.", (err as Error).message);
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) {
    throw new OidcError(401, "sso_invalid_token", "Your account didn't share an email address with InFrame.");
  }
  if (opts.nonce !== undefined && claims.data.nonce !== opts.nonce) {
    throw new OidcError(401, "sso_invalid_token", "That sign-in couldn't be verified. Try again.", "nonce mismatch");
  }
  return {
    sub: claims.data.sub,
    email: claims.data.email,
    emailVerified: claims.data.email_verified === true,
    name: claims.data.name?.trim() || null,
    picture: claims.data.picture || null,
  };
}

/**
 * Where to send a browser after its InFrame session ended, so the identity
 * server's session ends too (otherwise "Sign in" would let them straight back
 * in). Null when the identity server has no end-session endpoint.
 */
export async function endSessionUrl(): Promise<string | null> {
  if (!oidcConfigured()) return null;
  let doc: Discovery;
  try {
    ({ doc } = await getDiscovery());
  } catch {
    return null;
  }
  if (!doc.end_session_endpoint) return null;
  const url = new URL(doc.end_session_endpoint);
  url.searchParams.set("client_id", config.oidc.clientId);
  url.searchParams.set("post_logout_redirect_uri", config.oidc.postLogoutUri);
  return url.toString();
}

/** A fresh random value for `state` / `nonce`. */
export const oidcRandom = () => randomToken(24);
