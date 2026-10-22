import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { startDatabase } from "./support.js";

/*
 * Per-guest upload limits: what a guest (a member who isn't a host) may add
 * to an event, in files and in bytes, against the real API on PGlite.
 */

let app: FastifyInstance;
let database: Awaited<ReturnType<typeof startDatabase>>;
let pool: typeof import("../src/db/pool.js").pool;
let signAccessToken: typeof import("../src/auth/tokens.js").signAccessToken;
let spoolDir: string;

before(async () => {
  database = await startDatabase();
  spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), "inframe-limits-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "https://inframe.test",
    DATABASE_URL: database.url,
    JWT_SECRET: "test-jwt-secret-0123456789",
    ENCRYPTION_KEY: "test-encryption-key-0123456789",
    MEDIA_SECRET: "test-media-secret-0123456789",
    DEV_MEMORY_STORAGE: "true",
    SPOOL_DIR: spoolDir,
  });
  ({ pool } = await import("../src/db/pool.js"));
  ({ signAccessToken } = await import("../src/auth/tokens.js"));
  const { boss } = await import("../src/jobs/queue.js");
  (boss as unknown as { send: () => Promise<string> }).send = async () => crypto.randomUUID();
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

const tokens = new Map<string, string>();
async function signUp(name: string) {
  const row = (
    await pool.query("INSERT INTO users (email, name, oidc_sub) VALUES ($1, $2, $3) RETURNING id, token_version", [
      `${name}@example.com`,
      name,
      `sub-${name}`,
    ])
  ).rows[0];
  tokens.set(name, `Bearer ${await signAccessToken(row.id, row.token_version)}`);
  return row.id as string;
}

const as = (who: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: tokens.get(who)! }, ...(payload !== undefined ? { payload: payload as object } : {}) });

/** A multipart upload of `kb` kilobytes of noise, named `name`. */
function upload(who: string, eventId: string, name: string, kb = 1) {
  const boundary = `----inframe-test-${crypto.randomBytes(6).toString("hex")}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    crypto.randomBytes(kb * 1024),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `/api/events/${eventId}/photos`,
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, authorization: tokens.get(who)! },
  });
}

const spooled = () => fs.readdirSync(spoolDir).length;

let eventId = "";
let guestId = "";

describe("per-guest upload limits", () => {
  test("a new event starts at 300 files and 2 GB per guest; hosts have no allowance to watch", async () => {
    await signUp("owner");
    const conn = await as("owner", "POST", "/api/storage/dev-memory");
    assert.ok([200, 201].includes(conn.statusCode));
    const created = await as("owner", "POST", "/api/events", { name: "Picnic", kind: "party", storage: { connectionId: conn.json().connection.id } });
    assert.equal(created.statusCode, 201);
    const event = created.json().event;
    eventId = event.id;
    assert.equal(event.settings.guestMaxItems, 300);
    assert.equal(event.settings.guestMaxBytes, 2 * 1024 ** 3);
    assert.equal(event.guestAllowance, null);
  });

  test("a guest sees the allowance and what they've used of it", async () => {
    guestId = await signUp("guest");
    await signUp("cohost");
    await signUp("other");
    const code = (await pool.query("SELECT join_code FROM events WHERE id = $1", [eventId])).rows[0].join_code;
    for (const who of ["guest", "cohost", "other"]) assert.equal((await as(who, "POST", `/api/join/${code}`)).statusCode, 200);
    const cohostId = (await pool.query("SELECT id FROM users WHERE email = 'cohost@example.com'")).rows[0].id;
    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}/members/${cohostId}`, { role: "cohost" })).statusCode, 200);

    const seen = (await as("guest", "GET", `/api/events/${eventId}`)).json().event;
    assert.deepEqual(seen.guestAllowance, { maxItems: 300, maxBytes: 2 * 1024 ** 3, usedItems: 0, usedBytes: 0 });
    assert.equal((await as("cohost", "GET", `/api/events/${eventId}`)).json().event.guestAllowance, null, "a co-host is a host");
  });

  test("only the owner sets the limits, and they must make sense", async () => {
    assert.equal((await as("cohost", "PATCH", `/api/events/${eventId}`, { guestMaxItems: 5 })).statusCode, 403);
    assert.equal((await as("guest", "PATCH", `/api/events/${eventId}`, { guestMaxItems: 5 })).statusCode, 403);
    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxItems: 0 })).statusCode, 400);
    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxBytes: 10 })).statusCode, 400);
    // A co-host can still change the other sharing settings.
    assert.equal((await as("cohost", "PATCH", `/api/events/${eventId}`, { guestsSeeAll: true })).statusCode, 200);

    const res = await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxItems: 1, guestMaxBytes: null });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().event.settings.guestMaxItems, 1);
    assert.equal(res.json().event.settings.guestMaxBytes, null);
  });

  test("the file count is enforced for guests only, with a clear message", async () => {
    assert.equal((await upload("guest", eventId, "one.jpg")).statusCode, 202);
    const refused = await upload("guest", eventId, "two.jpg");
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "guest_limit");
    assert.equal(refused.json().message, "This event allows 1 photo per guest; you've reached it.");

    for (const [who, name] of [["owner", "o1.jpg"], ["owner", "o2.jpg"], ["cohost", "c1.jpg"]] as const) {
      assert.equal((await upload(who, eventId, name)).statusCode, 202, `${who} isn't capped`);
    }
    const seen = (await as("guest", "GET", `/api/events/${eventId}`)).json().event;
    assert.equal(seen.guestAllowance.usedItems, 1);
    assert.equal(seen.guestAllowance.usedBytes, 1024);
    assert.equal(spooled(), 4, "the refused file never reached the spool");
  });

  test("the size is enforced once the file is in, and the file is dropped", async () => {
    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxItems: null, guestMaxBytes: 1024 * 1024 })).statusCode, 200);
    assert.equal((await upload("other", eventId, "big-one.jpg", 600)).statusCode, 202);
    const refused = await upload("other", eventId, "big-two.jpg", 600);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "guest_limit");
    assert.equal(refused.json().message, "This event allows 1 MB per guest; you've used 600 KB, and this file would take you over it.");
    assert.equal(spooled(), 5, "the refused file was removed from the spool");
    // The message changes once they're flat out of room.
    await pool.query("UPDATE photos SET size_bytes = $2 WHERE event_id = $1 AND original_name = 'big-one.jpg'", [eventId, 1024 * 1024]);
    const full = await upload("other", eventId, "big-three.jpg", 1);
    assert.equal(full.json().message, "This event allows 1 MB per guest; you've reached it.");
  });

  test("no limit means no limit, and failed uploads don't count against one", async () => {
    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxBytes: null })).statusCode, 200);
    assert.equal((await upload("other", eventId, "big-four.jpg", 600)).statusCode, 202);

    assert.equal((await as("owner", "PATCH", `/api/events/${eventId}`, { guestMaxItems: 1 })).statusCode, 200);
    assert.equal((await upload("guest", eventId, "three.jpg")).statusCode, 409);
    await pool.query("UPDATE photos SET status = 'failed' WHERE event_id = $1 AND uploader_id = $2", [eventId, guestId]);
    assert.equal((await upload("guest", eventId, "three.jpg")).statusCode, 202, "the failed one isn't in storage, so it isn't counted");
  });
});
