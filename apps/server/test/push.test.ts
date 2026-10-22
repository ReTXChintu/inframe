import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { startDatabase } from "./support.js";

/*
 * Push notifications: phones registered per user, who hears about joins and invites, and new
 * photos told in batches (at most one per event per person every 30 minutes, never to the person
 * who added them, and to guests only when the event shares everyone's photos). Firebase is a fake.
 */

let app: FastifyInstance;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: typeof import("../src/db/pool.js").pool;
let signAccessToken: typeof import("../src/auth/tokens.js").signAccessToken;
let push: typeof import("../src/services/push.js");
let spoolDir: string;
const SECRET = "push-test-suite-secret-0123456789";

const sent: { token: string; title: string; body: string; data: Record<string, string> }[] = [];

before(async () => {
  database = await startDatabase();
  spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inframe-push-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "https://inframe.test",
    DATABASE_URL: database.url,
    JWT_SECRET: "test-jwt-secret-0123456789",
    ENCRYPTION_KEY: "test-encryption-key-0123456789",
    MEDIA_SECRET: "test-media-secret-0123456789",
    DEV_MEMORY_STORAGE: "true",
    SPOOL_DIR: spoolDir,
    TRIPPIN_SUITE_SECRET: SECRET,
  });
  delete process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  ({ pool } = await import("../src/db/pool.js"));
  ({ signAccessToken } = await import("../src/auth/tokens.js"));
  push = await import("../src/services/push.js");
  push.setPushSenderForTests(async (token, message) => {
    sent.push({ token, ...message });
    return "sent";
  });
  const { boss } = await import("../src/jobs/queue.js");
  (boss as unknown as { send: () => Promise<string> }).send = async () => crypto.randomUUID();
  const { migrate } = await import("../src/db/migrate.js");
  const { buildApp } = await import("../src/app.js");
  await migrate(() => {});
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  push?.setPushSenderForTests(null);
  await app?.close();
  await pool?.end();
  await database?.stop();
  fs.rmSync(spoolDir, { recursive: true, force: true });
});

beforeEach(() => {
  sent.length = 0;
});

let n = 0;
async function user(name: string) {
  n += 1;
  const row = (
    await pool.query("INSERT INTO users (email, name, oidc_sub) VALUES ($1, $2, $3) RETURNING id, token_version", [`${name}${n}@example.com`, name, `sub-${name}-${n}`])
  ).rows[0];
  const phone = `fcm-${name}-${n}-${crypto.randomBytes(4).toString("hex")}`;
  await pool.query("INSERT INTO device_tokens (token, user_id) VALUES ($1, $2)", [phone, row.id]);
  return { id: row.id as string, phone, auth: `Bearer ${await signAccessToken(row.id, row.token_version)}` };
}

async function event(ownerId: string, name: string, guestsSeeAll = true) {
  const row = (
    await pool.query("INSERT INTO events (owner_id, name, join_code, guests_see_all) VALUES ($1, $2, $3, $4) RETURNING id", [
      ownerId,
      name,
      `PUSH${++n}X`,
      guestsSeeAll,
    ])
  ).rows[0];
  await pool.query("INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, 'owner')", [row.id, ownerId]);
  return row.id as string;
}

const member = (eventId: string, userId: string, role: "cohost" | "member") =>
  pool.query("INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, $3)", [eventId, userId, role]);

const settle = () => new Promise((r) => setTimeout(r, 100));
const to = (phone: string) => sent.filter((s) => s.token === phone);

describe("phones", () => {
  test("register, move to whoever signs in on that phone, unregister", async () => {
    const a = await user("ann");
    const b = await user("bo");
    const token = `fcm-shared-${crypto.randomBytes(4).toString("hex")}`;
    const post = (auth: string, method: "POST" | "DELETE") =>
      app.inject({ method, url: "/api/me/devices", headers: { authorization: auth }, payload: { token } });
    assert.equal((await post(a.auth, "POST")).statusCode, 200);
    assert.equal((await post(b.auth, "POST")).statusCode, 200);
    assert.equal((await pool.query("SELECT user_id FROM device_tokens WHERE token = $1", [token])).rows[0].user_id, b.id);
    await post(a.auth, "DELETE");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM device_tokens WHERE token = $1", [token])).rows[0].n, 1, "not Ann's to remove");
    await post(b.auth, "DELETE");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM device_tokens WHERE token = $1", [token])).rows[0].n, 0);
    const bad = await app.inject({ method: "POST", url: "/api/me/devices", headers: { authorization: a.auth }, payload: { token: "x" } });
    assert.equal(bad.statusCode, 400);
  });
});

describe("joins", () => {
  test("joining with the code tells the owner; the owner's own join doesn't", async () => {
    const owner = await user("olga");
    const guest = await user("gus");
    const id = await event(owner.id, "Goa");
    const code = (await pool.query("SELECT join_code FROM events WHERE id = $1", [id])).rows[0].join_code;
    await pool.query("UPDATE events SET join_enabled = true WHERE id = $1", [id]);
    const res = await app.inject({ method: "POST", url: `/api/join/${code}`, headers: { authorization: guest.auth } });
    assert.equal(res.statusCode, 200, res.body);
    await settle();
    assert.deepEqual(
      to(owner.phone).map((s) => [s.title, s.data.type, s.data.link]),
      [["gus joined Goa", "JOINED", `inframe://app/events/${id}`]],
    );
    assert.equal(to(guest.phone).length, 0);
  });
});

describe("new photos", () => {
  test("told in one batch per event per person, never to whoever added them", async () => {
    const owner = await user("ola");
    const cohost = await user("cal");
    const guest = await user("gia");
    const id = await event(owner.id, "Lisbon");
    await member(id, cohost.id, "cohost");
    await member(id, guest.id, "member");

    await push.notePhotoReady(id, guest.id);
    await push.notePhotoReady(id, guest.id);
    await push.notePhotoReady(id, cohost.id);
    const t0 = new Date();
    assert.equal(await push.sendDuePhotoBatches(t0), 3);
    assert.deepEqual(to(owner.phone).map((s) => s.title), ["3 new photos in Lisbon"]);
    assert.deepEqual(to(cohost.phone).map((s) => s.title), ["2 new photos in Lisbon"]);
    assert.deepEqual(to(guest.phone).map((s) => s.title), ["1 new photo in Lisbon"]);
    assert.equal(to(owner.phone)[0]?.data.link, `inframe://app/events/${id}`);

    // More within 30 minutes wait; after that, one more notification with all of them.
    sent.length = 0;
    await push.notePhotoReady(id, guest.id);
    await push.notePhotoReady(id, guest.id);
    assert.equal(await push.sendDuePhotoBatches(new Date(t0.getTime() + 10 * 60_000)), 0);
    assert.equal(sent.length, 0);
    assert.equal(await push.sendDuePhotoBatches(new Date(t0.getTime() + 31 * 60_000)), 2);
    assert.deepEqual(to(owner.phone).map((s) => s.title), ["2 new photos in Lisbon"]);
    assert.equal(await push.sendDuePhotoBatches(new Date(t0.getTime() + 62 * 60_000)), 0, "nothing new: nothing sent");
  });

  test("guests hear only when the event shares everyone's photos; storage-folder photos are the owner's own", async () => {
    const owner = await user("oz");
    const guest = await user("gil");
    const cohost = await user("cy");
    const id = await event(owner.id, "Private", false);
    await member(id, guest.id, "member");
    await member(id, cohost.id, "cohost");

    await push.notePhotoReady(id, cohost.id);
    await push.notePhotoReady(id, null);
    await push.sendDuePhotoBatches(new Date());
    assert.equal(to(guest.phone).length, 0, "can't see others' photos here");
    assert.deepEqual(to(owner.phone).map((s) => s.title), ["1 new photo in Private"], "only the co-host's");
    assert.deepEqual(to(cohost.phone).map((s) => s.title), ["1 new photo in Private"], "the folder's one");
  });
});

describe("added from Trippin", () => {
  test("people Trippin puts on the event hear they're in; the owner doesn't", async () => {
    const owner = await user("tess");
    const friend = await user("fin");
    const sub = async (id: string) => (await pool.query("SELECT oidc_sub, email FROM users WHERE id = $1", [id])).rows[0];
    const [o, f] = [await sub(owner.id), await sub(friend.id)];
    const body = JSON.stringify({
      id: "push-link-1",
      type: "trip.linked",
      trip: {
        id: "trip-push",
        title: "Porto",
        startDate: "2026-12-04",
        endDate: "2026-12-06",
        owner: { sub: o.oidc_sub, email: o.email, name: "tess" },
        members: [
          { sub: o.oidc_sub, email: o.email, name: "tess", role: "owner" },
          { sub: f.oidc_sub, email: f.email, name: "fin", role: "viewer" },
        ],
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/integrations/trippin/events",
      headers: { "content-type": "application/json", "x-suite-timestamp": ts, "x-suite-signature": signature },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    await settle();
    const eventId = res.json().remoteId as string;
    assert.deepEqual(
      to(friend.phone).map((s) => [s.title, s.data.type, s.data.link]),
      [["You're in Porto", "ADDED", `inframe://app/events/${eventId}`]],
    );
    assert.equal(to(owner.phone).length, 0);
  });
});
