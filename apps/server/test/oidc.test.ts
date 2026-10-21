import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { io as connectSocket } from "socket.io-client";
import { startDatabase, startIdentityServer, type IdentityUser } from "./support.js";

/*
 * Sign-in through the shared OpenID Connect identity server, end to end:
 * a stub identity server (real HTTP, RS256 keys) and a real Postgres
 * (PGlite) behind the actual API.
 */

const APP_URL = "https://inframe.test";
const WEB_CLIENT = { webId: "inframe-web", webSecret: "web-client-secret" };

let app: FastifyInstance;
let idp: Awaited<ReturnType<typeof startIdentityServer>>;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: typeof import("../src/db/pool.js").pool;
let closeRealtime: () => Promise<void>;

before(async () => {
  database = await startDatabase();
  idp = await startIdentityServer(WEB_CLIENT);
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL,
    DATABASE_URL: database.url,
    JWT_SECRET: "test-jwt-secret-0123456789",
    ENCRYPTION_KEY: "test-encryption-key-0123456789",
    MEDIA_SECRET: "test-media-secret-0123456789",
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: WEB_CLIENT.webId,
    OIDC_CLIENT_SECRET: WEB_CLIENT.webSecret,
    OIDC_POST_LOGOUT_URI: `${APP_URL}/login`,
  });
  // Config is read at import time, so the server is only loaded once the environment is set.
  ({ pool } = await import("../src/db/pool.js"));
  const { migrate } = await import("../src/db/migrate.js");
  const { buildApp } = await import("../src/app.js");
  const realtime = await import("../src/realtime/io.js");
  closeRealtime = realtime.closeRealtime;
  await migrate(() => {});
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  realtime.attachRealtime(app.server);
});

after(async () => {
  await closeRealtime?.();
  await app?.close();
  await pool?.end();
  await idp?.close();
  await database?.stop();
});

const cookie = (res: LightMyRequestResponse, name: string) =>
  (res.cookies as { name: string; value: string }[]).find((c) => c.name === name && c.value !== "");

const user = (name: string, overrides: Partial<IdentityUser> = {}): IdentityUser => ({
  sub: `sub-${name}`,
  email: `${name}@example.com`,
  email_verified: true,
  name: name[0]!.toUpperCase() + name.slice(1),
  ...overrides,
});

/** The browser's round trip: /start → identity server → /callback. */
async function webSignIn(who: IdentityUser, opts: { returnTo?: string; nonce?: string; state?: string } = {}) {
  const start = await app.inject({
    method: "GET",
    url: "/api/auth/oidc/start",
    query: opts.returnTo ? { returnTo: opts.returnTo } : {},
  });
  assert.equal(start.statusCode, 302);
  const authorizeUrl = String(start.headers.location);
  const pending = cookie(start, "inframe_oidc");
  assert.ok(pending, "start sets the sign-in cookie");
  const { code, state } = idp.authorize(authorizeUrl, who, { nonce: opts.nonce });
  const callback = await app.inject({
    method: "GET",
    url: "/api/auth/oidc/callback",
    query: { code, state: opts.state ?? state },
    cookies: { inframe_oidc: pending.value },
  });
  assert.equal(callback.statusCode, 302);
  return { authorizeUrl, location: String(callback.headers.location), refresh: cookie(callback, "inframe_rt")?.value };
}

/** After the callback the web app calls /refresh to get its access token, as it does after any reload. */
async function accessTokenFrom(refresh: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { inframe_rt: refresh } });
  assert.equal(res.statusCode, 200);
  return res.json().accessToken as string;
}

const dbUser = async (email: string) =>
  (await pool.query("SELECT id, oidc_sub, is_admin, password_hash, name FROM users WHERE email = $1", [email])).rows[0];

describe("web sign-in", () => {
  test("start redirects to the identity server with PKCE, state and nonce", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/oidc/start", query: { returnTo: "/join/ABCD2345" } });
    assert.equal(res.statusCode, 302);
    const url = new URL(String(res.headers.location));
    assert.equal(`${url.origin}${url.pathname}`, `${idp.issuer}/authorize`);
    assert.equal(url.searchParams.get("client_id"), "inframe-web");
    assert.equal(url.searchParams.get("redirect_uri"), `${APP_URL}/api/auth/oidc/callback`);
    assert.equal(url.searchParams.get("scope"), "openid email profile offline_access");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("state") && url.searchParams.get("nonce") && url.searchParams.get("code_challenge"));
    const pending = (res.cookies as { name: string; httpOnly?: boolean; secure?: boolean; path?: string }[]).find(
      (c) => c.name === "inframe_oidc",
    );
    assert.ok(pending?.httpOnly && pending.secure, "the sign-in cookie is httpOnly and Secure on an https APP_URL");
    assert.equal(pending.path, "/api/auth/oidc");
  });

  test("the first person to sign in gets an admin account with a self person", async () => {
    const alice = user("alice");
    const { location, refresh } = await webSignIn(alice);
    assert.equal(location, `${APP_URL}/people?welcome=1`, "new accounts go to People to add a selfie");
    assert.ok(refresh, "a refresh cookie is set");

    const row = await dbUser(alice.email);
    assert.equal(row.oidc_sub, alice.sub);
    assert.equal(row.is_admin, true);
    assert.equal(row.password_hash, null);
    assert.equal(row.name, "Alice");
    const self = await pool.query("SELECT name FROM people WHERE owner_id = $1 AND kind = 'self'", [row.id]);
    assert.equal(self.rows.length, 1);

    const token = await accessTokenFrom(refresh!);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, alice.email);
    assert.equal(me.json().user.isAdmin, true);
    assert.equal(me.json().self.kind, "self");
  });

  test("signing in again finds the same account by sub", async () => {
    const alice = user("alice");
    const before = await dbUser(alice.email);
    const { location, refresh } = await webSignIn(alice);
    assert.equal(location, `${APP_URL}/`);
    assert.ok(refresh);
    assert.equal((await dbUser(alice.email)).id, before.id);
  });

  test("later accounts aren't admins, and a join link survives the sign-in", async () => {
    const bob = user("bob");
    const { location } = await webSignIn(bob, { returnTo: "/join/ABCD2345" });
    assert.equal(location, `${APP_URL}/join/ABCD2345`);
    assert.equal((await dbUser(bob.email)).is_admin, false);
  });

  test("an invite link survives the sign-in", async () => {
    const { location } = await webSignIn(user("bob"), { returnTo: "/invite/some-token?x=1" });
    assert.equal(location, `${APP_URL}/invite/some-token?x=1`);
  });

  test("returnTo can't send people off-site", async () => {
    const { location } = await webSignIn(user("bob"), { returnTo: "//evil.example/steal" });
    assert.equal(location, `${APP_URL}/`);
  });

  test("an existing account is linked by verified email", async () => {
    const created = await pool.query(
      "INSERT INTO users (email, name, password_hash) VALUES ('carol@example.com', 'Carol Old', 'legacy-hash') RETURNING id",
    );
    const count = Number((await pool.query("SELECT count(*) FROM users")).rows[0].count);
    const { location, refresh } = await webSignIn(user("carol", { name: "Carol New" }));
    assert.equal(location, `${APP_URL}/`, "a linked account isn't new");
    assert.ok(refresh);
    const row = await dbUser("carol@example.com");
    assert.equal(row.id, created.rows[0].id);
    assert.equal(row.oidc_sub, "sub-carol");
    assert.equal(row.name, "Carol Old", "the local name is kept");
    assert.equal(Number((await pool.query("SELECT count(*) FROM users")).rows[0].count), count);
  });

  test("an unverified email doesn't link to (or take over) an existing account", async () => {
    await pool.query("INSERT INTO users (email, name, password_hash) VALUES ('dave@example.com', 'Dave', 'legacy-hash')");
    const { location, refresh } = await webSignIn(user("dave", { email_verified: false }));
    assert.equal(location, `${APP_URL}/login?error=email_unverified`);
    assert.equal(refresh, undefined, "no session");
    assert.equal((await dbUser("dave@example.com")).oidc_sub, null);
  });

  test("an unverified email doesn't start a new account either", async () => {
    const { location, refresh } = await webSignIn(user("erin", { email_verified: false }), { returnTo: "/join/ABCD2345" });
    assert.equal(location, `${APP_URL}/login?error=email_unverified&next=%2Fjoin%2FABCD2345`);
    assert.equal(refresh, undefined);
    assert.equal(await dbUser("erin@example.com"), undefined);
  });

  test("a state that doesn't match the cookie is rejected", async () => {
    const { location, refresh } = await webSignIn(user("frank"), { state: "forged-state" });
    assert.equal(location, `${APP_URL}/login?error=expired`);
    assert.equal(refresh, undefined);
    assert.equal(await dbUser("frank@example.com"), undefined);
  });

  test("a callback without the sign-in cookie is rejected", async () => {
    const start = await app.inject({ method: "GET", url: "/api/auth/oidc/start" });
    const { code, state } = idp.authorize(String(start.headers.location), user("frank"));
    const res = await app.inject({ method: "GET", url: "/api/auth/oidc/callback", query: { code, state } });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `${APP_URL}/login?error=expired`);
    assert.equal(cookie(res, "inframe_rt"), undefined);
  });

  test("an ID token with the wrong nonce is rejected", async () => {
    const { location, refresh } = await webSignIn(user("frank"), { nonce: "someone-elses-nonce" });
    assert.equal(location, `${APP_URL}/login?error=sso_invalid_token`);
    assert.equal(refresh, undefined);
    assert.equal(await dbUser("frank@example.com"), undefined);
  });

  test("cancelling at the identity server comes back as cancelled", async () => {
    const start = await app.inject({ method: "GET", url: "/api/auth/oidc/start" });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/callback",
      query: { error: "access_denied", state: new URL(String(start.headers.location)).searchParams.get("state")! },
      cookies: { inframe_oidc: cookie(start, "inframe_oidc")!.value },
    });
    assert.equal(res.headers.location, `${APP_URL}/login?error=cancelled`);
  });

  test("sign-out ends the session and hands back the identity server's end-session URL", async () => {
    const { refresh } = await webSignIn(user("alice"));
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { inframe_rt: refresh! } });
    assert.equal(res.statusCode, 200);
    const url = new URL(res.json().endSessionUrl);
    assert.equal(`${url.origin}${url.pathname}`, `${idp.issuer}/logout`);
    assert.equal(url.searchParams.get("client_id"), "inframe-web");
    assert.equal(url.searchParams.get("post_logout_redirect_uri"), `${APP_URL}/login`);
    const again = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { inframe_rt: refresh! } });
    assert.equal(again.statusCode, 401);
  });

  test("password sign-up, login and reset are gone", async () => {
    for (const url of ["/api/auth/signup", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password"]) {
      const res = await app.inject({ method: "POST", url, payload: { email: "alice@example.com", password: "x" } });
      assert.equal(res.statusCode, 404, url);
    }
  });
});

describe("mobile sign-in", () => {
  const mobile = { "x-inframe-client": "mobile" };

  test("an ID token for inframe-mobile returns access and refresh tokens", async () => {
    const grace = user("grace");
    const idToken = await idp.idToken({ ...grace, aud: "inframe-mobile", nonce: "n-1" });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", headers: mobile, payload: { idToken, nonce: "n-1" } });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);
    assert.equal(body.user.email, grace.email);
    assert.equal(body.created, true);

    const self = await pool.query("SELECT 1 FROM people p JOIN users u ON u.id = p.owner_id WHERE u.email = $1 AND p.kind = 'self'", [
      grace.email,
    ]);
    assert.equal(self.rows.length, 1);

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { ...mobile, "x-refresh-token": body.refreshToken },
    });
    assert.equal(refreshed.statusCode, 200);
    assert.ok(refreshed.json().refreshToken, "the rotated refresh token comes back in the body");

    // Same person again: same account, 200.
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/oidc/mobile",
      headers: mobile,
      payload: { idToken: await idp.idToken({ ...grace, aud: "inframe-mobile" }) },
    });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().user.id, body.user.id);
  });

  test("an ID token for another audience is refused", async () => {
    const idToken = await idp.idToken({ ...user("heidi"), aud: "inframe-web" });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", headers: mobile, payload: { idToken } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "sso_invalid_token");
    assert.equal(await dbUser("heidi@example.com"), undefined);
  });

  test("an ID token signed with someone else's key is refused", async () => {
    const idToken = await idp.idToken({ ...user("heidi"), aud: "inframe-mobile" }, { key: await idp.strangerKey() });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", headers: mobile, payload: { idToken } });
    assert.equal(res.statusCode, 401);
  });

  test("an ID token from another issuer is refused", async () => {
    const idToken = await idp.idToken({ ...user("heidi"), aud: "inframe-mobile" }, { issuer: "https://elsewhere.example" });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", headers: mobile, payload: { idToken } });
    assert.equal(res.statusCode, 401);
  });

  test("a nonce mismatch is refused", async () => {
    const idToken = await idp.idToken({ ...user("heidi"), aud: "inframe-mobile", nonce: "n-1" });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", headers: mobile, payload: { idToken, nonce: "n-2" } });
    assert.equal(res.statusCode, 401);
  });

  test("only the app may use it", async () => {
    const idToken = await idp.idToken({ ...user("heidi"), aud: "inframe-mobile" });
    const res = await app.inject({ method: "POST", url: "/api/auth/oidc/mobile", payload: { idToken } });
    assert.equal(res.statusCode, 400);
  });
});

describe("a session from the identity server works everywhere", () => {
  test("upload tickets and Socket.IO accept it", async () => {
    const { refresh } = await webSignIn(user("ivan"));
    const token = await accessTokenFrom(refresh!);
    const ivan = await dbUser("ivan@example.com");
    const event = await pool.query("INSERT INTO events (owner_id, name, join_code) VALUES ($1, 'Trip', 'TICKET23') RETURNING id", [
      ivan.id,
    ]);
    const eventId = event.rows[0].id as string;
    await pool.query("INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, 'owner')", [eventId, ivan.id]);

    const issued = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/upload-ticket`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(issued.statusCode, 200);
    assert.equal(issued.json().expiresInSeconds, 24 * 60 * 60);

    // The ticket gets past authentication: the next check is the event's storage folder.
    const upload = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/photos`,
      headers: { "x-upload-ticket": issued.json().ticket },
    });
    assert.equal(upload.statusCode, 409);
    assert.match(upload.json().message, /Connect a folder/);
    const forged = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/photos`,
      headers: { "x-upload-ticket": "not-a-ticket" },
    });
    assert.equal(forged.statusCode, 401);

    const port = (app.server.address() as AddressInfo).port;
    const connect = (auth: { token: string }) =>
      new Promise<string>((resolve) => {
        const socket = connectSocket(`http://127.0.0.1:${port}`, { path: "/socket.io", auth, transports: ["websocket"], reconnection: false });
        socket.on("connect", () => {
          socket.emit("event:watch", eventId, (ok: boolean) => {
            socket.disconnect();
            resolve(ok ? "watching" : "connected");
          });
        });
        socket.on("connect_error", (err) => {
          socket.disconnect();
          resolve(`error: ${err.message}`);
        });
      });
    assert.equal(await connect({ token }), "watching");
    assert.equal(await connect({ token: "nope" }), "error: unauthorized");
  });
});

describe("account deletion", () => {
  test("takes a typed confirmation instead of a password", async () => {
    const { refresh } = await webSignIn(user("judy"));
    const token = await accessTokenFrom(refresh!);
    const auth = { authorization: `Bearer ${token}` };

    const wrong = await app.inject({ method: "DELETE", url: "/api/me", headers: auth, payload: { confirm: "delete please" } });
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.json().details.fields.confirm, "Type DELETE to confirm.");
    assert.ok(await dbUser("judy@example.com"));

    const res = await app.inject({ method: "DELETE", url: "/api/me", headers: auth, payload: { confirm: "DELETE" } });
    assert.equal(res.statusCode, 200);
    assert.equal(await dbUser("judy@example.com"), undefined);
    const after = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { inframe_rt: refresh! } });
    assert.equal(after.statusCode, 401);
  });

  test("the account's email works as the confirmation too", async () => {
    const { refresh } = await webSignIn(user("ken"));
    const token = await accessTokenFrom(refresh!);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { confirm: "KEN@example.com" },
    });
    assert.equal(res.statusCode, 200);
  });

  test("the password-change endpoint is gone", async () => {
    const { refresh } = await webSignIn(user("alice"));
    const token = await accessTokenFrom(refresh!);
    const res = await app.inject({
      method: "POST",
      url: "/api/me/password",
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: "a", newPassword: "b" },
    });
    assert.equal(res.statusCode, 404);
  });
});
