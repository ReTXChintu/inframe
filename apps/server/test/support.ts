import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

/**
 * A throwaway Postgres (PGlite, in-process, with pgvector and citext) behind
 * a real wire-protocol socket, so the server's `pg` pool talks to it unchanged.
 */
export async function startDatabase() {
  const db = await PGlite.create({ extensions: { vector, citext } });
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 32 });
  await server.start();
  const port = server.getServerConn().split(":").pop();
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

export interface IdentityUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

interface PendingCode {
  user: IdentityUser;
  clientId: string;
  redirectUri: string;
  nonce: string;
  challenge: string;
}

/**
 * A stand-in for the shared identity server: discovery, JWKS, a token
 * endpoint (confidential web client, PKCE) and RS256 ID tokens. "Signing in"
 * at its authorize endpoint is `authorize()`, which hands back the code the
 * browser would bring to InFrame's callback.
 */
export async function startIdentityServer(clients: { webId: string; webSecret: string }) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "test-key-1";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const codes = new Map<string, PendingCode>();
  let issuer = "";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", async () => {
        const form = new URLSearchParams(raw);
        const basic = req.headers.authorization?.startsWith("Basic ")
          ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":").map(decodeURIComponent)
          : null;
        const [clientId, secret] = basic ?? [form.get("client_id"), form.get("client_secret")];
        if (clientId !== clients.webId || secret !== clients.webSecret) return json(401, { error: "invalid_client" });
        const pending = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (
          !pending ||
          form.get("grant_type") !== "authorization_code" ||
          pending.clientId !== clientId ||
          pending.redirectUri !== form.get("redirect_uri") ||
          pending.challenge !== challenge
        ) {
          return json(400, { error: "invalid_grant" });
        }
        const idToken = await sign({ ...pending.user, aud: clientId, nonce: pending.nonce });
        json(200, { access_token: "stub-access", token_type: "Bearer", expires_in: 300, id_token: idToken });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function sign(claims: Record<string, unknown>, opts: { key?: CryptoKey; issuer?: string } = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(opts.issuer ?? issuer)
      .setSubject(String(claims.sub))
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(opts.key ?? privateKey);
  }

  return {
    get issuer() {
      return issuer;
    },
    /**
     * The person signs in at the identity server: checks the authorize
     * request and returns where the browser is sent back to. `nonce`
     * overrides the one the ID token will carry (to simulate a mix-up).
     */
    authorize(authorizeUrl: string, user: IdentityUser, overrides: { nonce?: string } = {}) {
      const params = new URL(authorizeUrl).searchParams;
      if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
        throw new Error("authorize: expected the code flow with S256 PKCE");
      }
      const code = crypto.randomBytes(16).toString("base64url");
      codes.set(code, {
        user,
        clientId: params.get("client_id") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        nonce: overrides.nonce ?? params.get("nonce") ?? "",
        challenge: params.get("code_challenge") ?? "",
      });
      return { code, state: params.get("state") ?? "", redirectUri: params.get("redirect_uri") ?? "" };
    },
    /** An ID token as the mobile app would receive it from the identity server. */
    idToken: (claims: IdentityUser & { aud: string; nonce?: string }, opts?: { key?: CryptoKey; issuer?: string }) =>
      sign({ ...claims }, opts),
    /** A key the identity server never published (forged tokens). */
    strangerKey: async () => (await generateKeyPair("RS256")).privateKey,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
