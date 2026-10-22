import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { startDatabase } from "./support.js";

/*
 * The Trippin integration end to end: signed server-to-server calls against
 * the real API on a real Postgres (PGlite). The job queue isn't running here;
 * jobs the API would queue are recorded instead.
 */

const APP_URL = "https://inframe.test";
const SECRET = "trippin-suite-secret-0123456789";

let app: FastifyInstance;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: typeof import("../src/db/pool.js").pool;
let signAccessToken: typeof import("../src/auth/tokens.js").signAccessToken;
let spoolDir: string;
const queued: { name: string; data: unknown }[] = [];

before(async () => {
  database = await startDatabase();
  spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inframe-trippin-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL,
    DATABASE_URL: database.url,
    JWT_SECRET: "test-jwt-secret-0123456789",
    ENCRYPTION_KEY: "test-encryption-key-0123456789",
    MEDIA_SECRET: "test-media-secret-0123456789",
    TRIPPIN_SUITE_SECRET: SECRET,
    DEV_MEMORY_STORAGE: "true",
    SPOOL_DIR: spoolDir,
  });
  // Config is read at import time, so the server is only loaded once the environment is set.
  ({ pool } = await import("../src/db/pool.js"));
  ({ signAccessToken } = await import("../src/auth/tokens.js"));
  const { boss } = await import("../src/jobs/queue.js");
  (boss as unknown as { send: (name: string, data: unknown) => Promise<string> }).send = async (name, data) => {
    queued.push({ name, data });
    return crypto.randomUUID();
  };
  const { migrate } = await import("../src/db/migrate.js");
  const { buildApp } = await import("../src/app.js");
  await migrate(() => {});
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app?.close();
  await pool?.end();
  await database?.stop();
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

// ─── Signed requests, as Trippin sends them ─────────────────────────────

const hmac = (secret: string, text: string) => `sha256=${crypto.createHmac("sha256", secret).update(text).digest("hex")}`;
const now = () => Math.floor(Date.now() / 1000);

interface SignOpts {
  timestamp?: number;
  secret?: string;
  /** Send these bytes instead of the ones that were signed. */
  tamper?: string;
  unsigned?: boolean;
}

function signed(method: "GET" | "POST", url: string, body?: unknown, opts: SignOpts = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(opts.timestamp ?? now());
  const headers: Record<string, string> = opts.unsigned
    ? {}
    : { "x-suite-timestamp": ts, "x-suite-signature": hmac(opts.secret ?? SECRET, `${ts}.${raw}`) };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.inject({ method, url, headers, ...(body !== undefined ? { payload: opts.tamper ?? raw } : {}) });
}

let deliveries = 0;
const deliver = (type: string, trip: Record<string, unknown>, opts: SignOpts & { id?: string } = {}) =>
  signed("POST", "/api/integrations/trippin/events", { id: opts.id ?? `dlv-${++deliveries}`, type, occurredAt: new Date().toISOString(), trip }, opts);

const summary = (tripId: string, sub?: string) =>
  signed("GET", `/api/integrations/trippin/trips/${encodeURIComponent(tripId)}/summary${sub ? `?sub=${encodeURIComponent(sub)}` : ""}`);

// ─── People ──────────────────────────────────────────────────────────────

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.com`, name: name[0]!.toUpperCase() + name.slice(1) });
const olivia = person("olivia"); // trip owner, first person InFrame ever sees
const ed = person("ed"); // editor
const vic = person("vic"); // viewer
const nora = person("nora"); // added later

const trip = (overrides: Record<string, unknown> = {}) => ({
  id: "trip-1",
  title: "Lisbon long weekend",
  startDate: "2026-11-06",
  endDate: "2026-11-09",
  destination: "Lisbon",
  url: "https://trippin.test/trips/trip-1",
  owner: olivia,
  members: [
    { ...olivia, role: "owner" },
    { ...ed, role: "editor" },
    { ...vic, role: "viewer" },
  ],
  ...overrides,
});

const userBySub = async (sub: string) =>
  (await pool.query("SELECT id, email, name, is_admin, token_version FROM users WHERE oidc_sub = $1", [sub])).rows[0];

async function tokenFor(sub: string) {
  const u = await userBySub(sub);
  assert.ok(u, `${sub} has an account`);
  return `Bearer ${await signAccessToken(u.id, u.token_version)}`;
}

const as = async (sub: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: await tokenFor(sub) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

function photoUpload(name: string) {
  const boundary = `----inframe-test-${crypto.randomBytes(6).toString("hex")}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    crypto.randomBytes(512),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function upload(sub: string, eventId: string, name = "beach.jpg") {
  const { payload, headers } = photoUpload(name);
  return app.inject({ method: "POST", url: `/api/events/${eventId}/photos`, payload, headers: { ...headers, authorization: await tokenFor(sub) } });
}

const roles = async (eventId: string) =>
  Object.fromEntries(
    (await pool.query("SELECT u.oidc_sub, m.role FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1", [eventId])).rows.map(
      (r) => [r.oidc_sub, r.role],
    ),
  );

let eventId = "";

describe("suite signature", () => {
  test("a correctly signed request is accepted", async () => {
    const res = await signed("GET", `/api/integrations/trippin/users/${olivia.sub}`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { exists: false });
  });

  test("a signature made with another secret is refused", async () => {
    const res = await signed("GET", `/api/integrations/trippin/users/${olivia.sub}`, undefined, { secret: "not-the-shared-secret-at-all" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "bad_signature");
  });

  test("a stale (or future) timestamp is refused even with a valid signature", async () => {
    for (const timestamp of [now() - 6 * 60, now() + 6 * 60]) {
      const res = await signed("GET", `/api/integrations/trippin/users/${olivia.sub}`, undefined, { timestamp });
      assert.equal(res.statusCode, 401);
    }
    const fresh = await signed("GET", `/api/integrations/trippin/users/${olivia.sub}`, undefined, { timestamp: now() - 4 * 60 });
    assert.equal(fresh.statusCode, 200, "within five minutes is fine");
  });

  test("a tampered body is refused and changes nothing", async () => {
    const body = { id: "tampered-1", type: "trip.linked", occurredAt: new Date().toISOString(), trip: trip() };
    const forged = JSON.stringify({ ...body, trip: trip({ title: "Someone else's trip" }) });
    const res = await signed("POST", "/api/integrations/trippin/events", body, { tamper: forged });
    assert.equal(res.statusCode, 401);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 0);
  });

  test("every route is unreachable without a signature", async () => {
    const calls = [
      app.inject({ method: "POST", url: "/api/integrations/trippin/events", payload: { id: "x", type: "trip.linked", trip: trip() } }),
      app.inject({ method: "GET", url: "/api/integrations/trippin/trips/trip-1/summary" }),
      app.inject({ method: "GET", url: `/api/integrations/trippin/users/${olivia.sub}` }),
      // Headers present but junk.
      app.inject({
        method: "GET",
        url: `/api/integrations/trippin/users/${olivia.sub}`,
        headers: { "x-suite-timestamp": "yesterday", "x-suite-signature": "sha256=00" },
      }),
      // A user's bearer token is no substitute.
      app.inject({ method: "GET", url: `/api/integrations/trippin/users/${olivia.sub}`, headers: { authorization: "Bearer abc" } }),
    ];
    for (const res of await Promise.all(calls)) assert.equal(res.statusCode, 401);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, 0);
  });
});

describe("trip.linked", () => {
  test("creates a trip event waiting for storage, with just-in-time accounts and mapped roles", async () => {
    const res = await deliver("trip.linked", trip(), { id: "link-1" });
    assert.equal(res.statusCode, 200);
    const { remoteId, url } = res.json();
    assert.ok(remoteId);
    assert.equal(url, `${APP_URL}/events/${remoteId}`);
    eventId = remoteId;

    const e = (await pool.query("SELECT * FROM events WHERE id = $1", [eventId])).rows[0];
    assert.equal(e.kind, "trip");
    assert.equal(e.name, "Lisbon long weekend");
    assert.equal(e.starts_on, "2026-11-06");
    assert.equal(e.ends_on, "2026-11-09");
    assert.equal(e.external_source, "trippin");
    assert.equal(e.external_id, "trip-1");
    assert.equal(e.external_url, "https://trippin.test/trips/trip-1");
    assert.equal(e.external_linked, true);
    assert.equal(e.storage_connection_id, null);
    assert.equal(e.storage_folder_id, null);
    assert.match(e.join_code, /^[A-Z0-9]{8}$/);
    assert.equal(e.join_enabled, false, "the people come from the trip: the code starts off");

    // Everyone was created just in time, like a first sign-in: a self person each, the first one admin.
    const owner = await userBySub(olivia.sub);
    assert.equal(e.owner_id, owner.id);
    assert.equal(owner.is_admin, true, "the very first account is the admin");
    assert.equal(owner.email, olivia.email);
    assert.equal(owner.name, "Olivia");
    assert.equal((await userBySub(ed.sub)).is_admin, false);
    for (const p of [olivia, ed, vic]) {
      const self = await pool.query("SELECT name FROM people WHERE owner_id = $1 AND kind = 'self'", [(await userBySub(p.sub)).id]);
      assert.equal(self.rows.length, 1, `${p.name} has a self person`);
      assert.equal(self.rows[0].name, p.name);
    }

    assert.deepEqual(await roles(eventId), { [olivia.sub]: "owner", [ed.sub]: "cohost", [vic.sub]: "member" });
  });

  test("the same delivery again is answered the same and applied once", async () => {
    const res = await deliver("trip.linked", trip(), { id: "link-1" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { remoteId: eventId, url: `${APP_URL}/events/${eventId}` });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM integration_events WHERE id = 'link-1'")).rows[0].n, 1);
  });

  test("the app shows the event as planned in Trippin and waiting for a folder", async () => {
    const res = await as(olivia.sub, "GET", `/api/events/${eventId}`);
    assert.equal(res.statusCode, 200);
    const event = res.json().event;
    assert.deepEqual(event.external, { source: "trippin", url: "https://trippin.test/trips/trip-1", linked: true });
    assert.equal(event.storage.pending, true);
    assert.equal(event.storage.connected, false);
    assert.equal(event.can.upload, false);
    assert.equal(event.isOwner, true);

    const list = await as(vic.sub, "GET", "/api/events");
    const item = list.json().events.find((x: { id: string }) => x.id === eventId);
    assert.equal(item.storagePending, true);
    assert.equal(item.external.linked, true);
    assert.equal(item.role, "member");
  });

  test("uploads are refused politely while storage is pending", async () => {
    const owner = await upload(olivia.sub, eventId);
    assert.equal(owner.statusCode, 409);
    assert.equal(owner.json().code, "storage_pending");
    assert.equal(owner.json().message, "Connect a folder to start adding photos.");

    const member = await upload(vic.sub, eventId);
    assert.equal(member.statusCode, 409);
    assert.equal(member.json().message, "Photos will appear once the owner connects a folder.");

    // A background-upload ticket is only a pass; the upload it carries is what gets refused.
    const ticket = await as(ed.sub, "POST", `/api/events/${eventId}/upload-ticket`);
    assert.equal(ticket.statusCode, 200);
    const { payload, headers } = photoUpload("queued-on-phone.jpg");
    const viaTicket = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/photos`,
      payload,
      headers: { ...headers, "x-upload-ticket": ticket.json().ticket },
    });
    assert.equal(viaTicket.statusCode, 409);
    assert.equal(viaTicket.json().code, "storage_pending");

    const sync = await as(olivia.sub, "POST", `/api/events/${eventId}/sync`);
    assert.equal(sync.statusCode, 409);

    assert.equal((await pool.query("SELECT count(*)::int AS n FROM photos")).rows[0].n, 0);
    assert.equal(queued.length, 0);
  });

  test("the summary reports that storage is needed", async () => {
    const res = await summary("trip-1", olivia.sub);
    assert.equal(res.statusCode, 200);
    const s = res.json();
    assert.equal(s.linked, true);
    assert.equal(s.needsStorage, true);
    assert.equal(s.photoCount, 0);
    assert.equal(s.videoCount, 0);
    assert.equal(s.albumCount, 0);
    assert.equal(s.coverThumbUrl, null);
    assert.equal(s.url, `${APP_URL}/events/${eventId}`);
    assert.ok(!Number.isNaN(Date.parse(s.updatedAt)));
  });
});

describe("connecting storage later", () => {
  test("an album made while pending survives, and the event starts taking photos", async () => {
    const album = await as(olivia.sub, "POST", `/api/events/${eventId}/folders`, { name: "Day one" });
    assert.equal(album.statusCode, 201);

    const conn = await as(olivia.sub, "POST", "/api/storage/dev-memory");
    assert.ok([200, 201].includes(conn.statusCode));
    const connectionId = conn.json().connection.id;

    // The existing change-storage flow; no folder given = create a new one.
    const res = await as(olivia.sub, "PUT", `/api/events/${eventId}/storage`, { connectionId });
    assert.equal(res.statusCode, 200);
    const event = res.json().event;
    assert.equal(res.json().removedPhotos, 0);
    assert.equal(event.storage.pending, false);
    assert.equal(event.storage.connected, true);
    assert.equal(event.storage.folderName, "InFrame · Lisbon long weekend");
    assert.equal(event.can.upload, true);
    assert.deepEqual(event.folders.map((f: { name: string }) => f.name), ["Day one"]);

    const up = await upload(vic.sub, eventId, "sunset.jpg");
    assert.equal(up.statusCode, 202);
    assert.equal(up.json().photo.originalName, "sunset.jpg");
    assert.ok(queued.some((j) => j.name === "photo-ingest"), "the upload was queued for storing");
  });

  test("the summary counts ready photos, videos and albums, with a cover only for members", async () => {
    const owner = await userBySub(olivia.sub);
    // Stored media (as the workers would leave it): two photos, one video, and one still processing.
    await pool.query("UPDATE photos SET status = 'ready' WHERE event_id = $1", [eventId]);
    await pool.query(
      `INSERT INTO photos (event_id, uploader_id, source, original_name, media_type, status, storage_file_id)
       VALUES ($1, $2, 'storage', 'a.jpg', 'image', 'ready', 'mem-a'),
              ($1, $2, 'storage', 'clip.mp4', 'video', 'ready', 'mem-b'),
              ($1, $2, 'storage', 'later.jpg', 'image', 'pending', 'mem-c')`,
      [eventId, owner.id],
    );
    await pool.query("INSERT INTO folders (event_id, name) VALUES ($1, 'Day two')", [eventId]);

    const res = await summary("trip-1", vic.sub);
    assert.equal(res.statusCode, 200);
    const s = res.json();
    assert.equal(s.photoCount, 2);
    assert.equal(s.videoCount, 1);
    assert.equal(s.albumCount, 2);
    assert.equal(s.needsStorage, false);
    assert.match(s.coverThumbUrl, new RegExp(`^${APP_URL}/media/p/[0-9a-f-]{36}/thumb\\?e=\\d+&s=`));
    // The signed URL really loads for anyone holding it (no session needed): it's
    // past the signature check and only fails on reaching the fake storage.
    const path = s.coverThumbUrl.slice(APP_URL.length);
    const media = await app.inject({ method: "GET", url: path });
    assert.notEqual(media.statusCode, 403);
    assert.notEqual(media.statusCode, 401);

    assert.equal((await summary("trip-1", "sub-stranger")).json().coverThumbUrl, null, "not a member: no cover");
    assert.equal((await summary("trip-1")).json().coverThumbUrl, null, "no viewer: no cover");
  });

  test("a trip that isn't linked has no summary", async () => {
    const res = await summary("trip-unknown", olivia.sub);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { linked: false });
  });
});

describe("keeping the event in step", () => {
  test("trip.updated renames the event and moves its dates", async () => {
    const res = await deliver("trip.updated", trip({ title: "Lisbon & Sintra", startDate: "2026-11-05", endDate: "2026-11-10" }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {});
    const e = (await pool.query("SELECT name, starts_on, ends_on FROM events WHERE id = $1", [eventId])).rows[0];
    assert.deepEqual({ ...e }, { name: "Lisbon & Sintra", starts_on: "2026-11-05", ends_on: "2026-11-10" });
  });

  test("trip.members_changed adds and removes Trippin's members, never the owner or people who joined in InFrame", async () => {
    // Someone who joined with the event's code, in InFrame itself — once the owner opened the code up.
    await pool.query("INSERT INTO users (email, name, oidc_sub) VALUES ('jo@example.com', 'Jo', 'sub-jo')");
    const code = (await pool.query("SELECT join_code FROM events WHERE id = $1", [eventId])).rows[0].join_code;
    assert.equal((await as("sub-jo", "POST", `/api/join/${code}`)).statusCode, 404, "a linked event's code is off until the owner turns it on");
    assert.equal((await as(olivia.sub, "PATCH", `/api/events/${eventId}`, { joinEnabled: true })).statusCode, 200);
    assert.equal((await as("sub-jo", "POST", `/api/join/${code}`)).statusCode, 200);

    // Vic leaves the trip, Nora joins, Ed becomes a viewer; the owner isn't even listed.
    const res = await deliver(
      "trip.members_changed",
      trip({ title: "Lisbon & Sintra", members: [{ ...ed, role: "viewer" }, { ...nora, role: "editor" }] }),
      { id: "members-1" },
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {});
    assert.deepEqual(await roles(eventId), {
      [olivia.sub]: "owner",
      [ed.sub]: "member",
      [nora.sub]: "cohost",
      "sub-jo": "member",
    });
    const noraSelf = await pool.query("SELECT 1 FROM people WHERE owner_id = $1 AND kind = 'self'", [(await userBySub(nora.sub)).id]);
    assert.equal(noraSelf.rows.length, 1, "Nora was created just in time with her self person");

    // Removed from the event, Vic loses access to it.
    assert.equal((await as(vic.sub, "GET", `/api/events/${eventId}`)).statusCode, 404);

    // A late duplicate of that delivery doesn't undo anything that happened since.
    await pool.query("UPDATE event_members SET role = 'cohost' WHERE event_id = $1 AND user_id = $2", [eventId, (await userBySub(ed.sub)).id]);
    await deliver("trip.members_changed", trip({ members: [{ ...ed, role: "viewer" }, { ...nora, role: "editor" }] }), { id: "members-1" });
    assert.equal((await roles(eventId))[ed.sub], "cohost");
  });

  test("trip.unlinked unlinks and keeps the event, its members and photos", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM photos WHERE event_id = $1", [eventId])).rows[0].n;
    const res = await deliver("trip.unlinked", { id: "trip-1" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {});

    const e = (await pool.query("SELECT name, external_linked, external_id FROM events WHERE id = $1", [eventId])).rows[0];
    assert.equal(e.external_linked, false);
    assert.equal(e.external_id, "trip-1", "it remembers it was linked");
    assert.equal(e.name, "Lisbon & Sintra");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM photos WHERE event_id = $1", [eventId])).rows[0].n, before);
    assert.ok(before > 0);
    assert.equal((await roles(eventId))[nora.sub], "cohost");

    const detail = (await as(olivia.sub, "GET", `/api/events/${eventId}`)).json().event;
    assert.deepEqual(detail.external, { source: "trippin", url: "https://trippin.test/trips/trip-1", linked: false });

    // No longer steered by Trippin, and no summary for it.
    await deliver("trip.updated", trip({ title: "Renamed after unlinking" }));
    assert.equal((await pool.query("SELECT name FROM events WHERE id = $1", [eventId])).rows[0].name, "Lisbon & Sintra");
    assert.equal((await summary("trip-1", olivia.sub)).statusCode, 404);
  });

  test("linking the same trip again re-links the existing event", async () => {
    const res = await deliver("trip.linked", trip({ title: "Lisbon, again", members: [{ ...ed, role: "editor" }] }), { id: "link-2" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().remoteId, eventId);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, 1);
    const e = (await pool.query("SELECT name, external_linked FROM events WHERE id = $1", [eventId])).rows[0];
    assert.equal(e.external_linked, true);
    assert.equal(e.name, "Lisbon, again");
    const r = await roles(eventId);
    assert.equal(r[ed.sub], "cohost");
    assert.equal(r[nora.sub], undefined, "no longer on the trip");
    assert.equal(r["sub-jo"], "member", "joined in InFrame, so stays");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM photos WHERE event_id = $1", [eventId])).rows[0].n > 0, true);
    assert.equal((await summary("trip-1", ed.sub)).json().needsStorage, false);
  });

  test("an existing InFrame account is never claimed by email from Trippin", async () => {
    await pool.query("INSERT INTO users (email, name) VALUES ('legacy@example.com', 'Legacy')");
    const res = await deliver(
      "trip.members_changed",
      trip({ title: "Lisbon, again", members: [{ ...ed, role: "editor" }, { sub: "sub-impostor", email: "legacy@example.com", name: "X", role: "viewer" }] }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal((await pool.query("SELECT oidc_sub FROM users WHERE email = 'legacy@example.com'")).rows[0].oidc_sub, null);
    assert.equal(await userBySub("sub-impostor"), undefined);
  });

  test("validation: a linked trip needs its details", async () => {
    const res = await deliver("trip.linked", { id: "trip-2", title: "" });
    assert.equal(res.statusCode, 400);
  });
});

describe("users/:sub", () => {
  test("says whether InFrame knows the identity", async () => {
    assert.deepEqual((await signed("GET", `/api/integrations/trippin/users/${olivia.sub}`)).json(), { exists: true });
    assert.deepEqual((await signed("GET", "/api/integrations/trippin/users/sub-nobody")).json(), { exists: false });
  });
});

describe("linking an existing event", () => {
  let codes = 0;
  async function event(ownerSub: string, name: string, startsOn: string | null, endsOn: string | null, external?: { id: string; linked: boolean }) {
    const owner = await userBySub(ownerSub);
    const row = (
      await pool.query(
        `INSERT INTO events (owner_id, name, kind, starts_on, ends_on, join_code, external_source, external_id, external_linked)
         VALUES ($1, $2, 'trip', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [owner.id, name, startsOn, endsOn, `ATTACH${++codes}`, external ? "trippin" : null, external?.id ?? null, external?.linked ?? null],
      )
    ).rows[0];
    await pool.query("INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, 'owner')", [row.id, owner.id]);
    return row.id as string;
  }

  const porto = (overrides: Record<string, unknown> = {}) =>
    trip({ id: "trip-porto", title: "Porto weekend", startDate: "2026-12-04", endDate: "2026-12-06", url: "https://trippin.test/trips/trip-porto", ...overrides });

  const candidates = (query: Record<string, string>) =>
    signed("GET", `/api/integrations/trippin/candidates?${new URLSearchParams({ tripId: "trip-porto", title: "Porto weekend", start: "2026-12-04", end: "2026-12-06", ...query })}`);

  let overlapping = "";
  let named = "";
  let elsewhere = "";
  let notHers = "";

  test("candidates: the owner's events, best match first; others' and ones linked elsewhere left out", async () => {
    overlapping = await event(olivia.sub, "December break", "2026-12-03", "2026-12-05");
    named = await event(olivia.sub, "Porto 2024", "2024-05-01", "2024-05-03");
    elsewhere = await event(olivia.sub, "Porto too", "2026-12-04", "2026-12-06", { id: "trip-other", linked: true });
    notHers = await event(ed.sub, "Porto weekend", "2026-12-04", "2026-12-06");

    const res = await candidates({ sub: olivia.sub });
    assert.equal(res.statusCode, 200);
    const list = res.json().candidates as { id: string; name: string; linkedHere: boolean; counts: Record<string, number>; impact: null }[];
    const ids = list.map((c) => c.id);
    assert.equal(ids[0], overlapping);
    assert.equal(ids[1], named);
    assert.ok(!ids.includes(elsewhere));
    assert.ok(!ids.includes(notHers));
    assert.deepEqual(list[0]?.counts, { photos: 0, videos: 0, members: 1 });
    assert.equal(list[0]?.impact, null);
    assert.equal(list[0]?.linkedHere, false);

    assert.deepEqual((await candidates({ sub: "sub-nobody" })).json(), { candidates: [] });
    assert.equal((await candidates({ sub: olivia.sub, start: "soon" })).statusCode, 400);
    assert.equal((await signed("GET", "/api/integrations/trippin/candidates?sub=x", undefined, { unsigned: true })).statusCode, 401);
  });

  test("attachTo links the chosen event instead of making one", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n;
    const res = await signed("POST", "/api/integrations/trippin/events", {
      id: "attach-1",
      type: "trip.linked",
      trip: porto(),
      attachTo: overlapping,
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().remoteId, overlapping);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events")).rows[0].n, before, "no new event");
    const e = (await pool.query("SELECT name, external_id, external_linked, to_char(starts_on, 'YYYY-MM-DD') AS s FROM events WHERE id = $1", [overlapping])).rows[0];
    assert.deepEqual(e, { name: "Porto weekend", external_id: "trip-porto", external_linked: true, s: "2026-12-04" });
    assert.equal((await summary("trip-porto", olivia.sub)).json().url, `${APP_URL}/events/${overlapping}`);
    const listed = (await candidates({ sub: olivia.sub })).json().candidates as { id: string; linkedHere: boolean }[];
    assert.equal(listed[0]?.id, overlapping);
    assert.equal(listed[0]?.linkedHere, true);
  });

  test("attaching another event takes the link over; the old one becomes an ordinary event", async () => {
    await deliver("trip.unlinked", { id: "trip-porto" });
    const res = await signed("POST", "/api/integrations/trippin/events", { id: "attach-2", type: "trip.linked", trip: porto(), attachTo: named });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().remoteId, named);
    const old = (await pool.query("SELECT external_source, external_id FROM events WHERE id = $1", [overlapping])).rows[0];
    assert.deepEqual(old, { external_source: null, external_id: null });
  });

  test("refuses someone else's event and one linked to another trip, changing nothing", async () => {
    for (const [attachTo, code] of [
      [notHers, "attach_not_found"],
      [crypto.randomUUID(), "attach_not_found"],
      ["not-a-uuid", "attach_not_found"],
      [elsewhere, "attach_linked_elsewhere"],
    ] as const) {
      const res = await signed("POST", "/api/integrations/trippin/events", { id: `refuse-${attachTo}`, type: "trip.linked", trip: porto(), attachTo });
      assert.equal(res.statusCode, 409, attachTo);
      assert.equal(res.json().code ?? res.json().error?.code, code, res.body);
    }
    assert.equal((await pool.query("SELECT external_id FROM events WHERE id = $1", [named])).rows[0].external_id, "trip-porto", "still linked");
    assert.equal((await pool.query("SELECT external_id FROM events WHERE id = $1", [elsewhere])).rows[0].external_id, "trip-other");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM integration_events WHERE id LIKE 'refuse-%'")).rows[0].n, 0);
  });
});
