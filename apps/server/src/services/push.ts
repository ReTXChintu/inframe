import fs from "node:fs";
import { SignJWT, importPKCS8 } from "jose";
import { one, query } from "../db/pool.js";

/*
 * Push notifications to the phone app, through Firebase Cloud Messaging (HTTP v1).
 *
 * Configured by the Firebase project's service-account key file, named in
 * FIREBASE_SERVICE_ACCOUNT_FILE (the suite shares one project with SpendLog and Trippin).
 * Without it nothing is sent and nothing fails.
 *
 * Every push carries `type`, `eventId` and `link` (inframe://app/events/<id>, the same route an
 * App Link opens) so a tap opens the event.
 */

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

type Sender = (token: string, message: PushMessage) => Promise<"sent" | "gone" | "failed">;

let account: ServiceAccount | null | undefined;
let accessToken: { value: string; expires: number } | null = null;
let testSender: Sender | null = null;

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const file = (process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? "").trim();
  try {
    if (!file) throw new Error("not set");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("incomplete");
    account = parsed;
  } catch {
    account = null;
  }
  return account;
}

export function pushAvailable(): boolean {
  return testSender !== null || serviceAccount() !== null;
}

/** Stands in for Firebase in the tests; null puts it back. */
export function setPushSenderForTests(sender: Sender | null): void {
  testSender = sender;
}

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.value;
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

const fcmSender: Sender = async (token, message) => {
  const sa = serviceAccount();
  if (!sa) return "failed";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleAccessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "HIGH", notification: { channel_id: "inframe_updates" } },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (res?.ok) return "sent";
  if (res && (res.status === 404 || res.status === 400)) return "gone";
  return "failed";
};

/** Sends to every phone of the user's; tokens Firebase no longer knows are dropped. Never throws. */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  try {
    if (!pushAvailable()) return 0;
    const devices = await query<{ token: string }>("SELECT token FROM device_tokens WHERE user_id = $1", [userId]);
    const send = testSender ?? fcmSender;
    let sent = 0;
    const gone: string[] = [];
    for (const { token } of devices) {
      const result = await send(token, message).catch(() => "failed" as const);
      if (result === "sent") sent += 1;
      else if (result === "gone") gone.push(token);
    }
    if (gone.length > 0) await query("DELETE FROM device_tokens WHERE token = ANY($1::text[])", [gone]);
    return sent;
  } catch (err) {
    console.error("[push] couldn't send:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Fire and forget: never holds up, or fails, what caused it. */
export function notify(userId: string, message: PushMessage): void {
  void pushToUser(userId, message);
}

export const eventData = (type: string, eventId: string): Record<string, string> => ({
  type,
  eventId,
  link: `inframe://app/events/${eventId}`,
});

export async function registerDevice(userId: string, token: string, platform = "android"): Promise<void> {
  await query(
    `INSERT INTO device_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`,
    [token, userId, platform],
  );
}

export async function unregisterDevice(userId: string, token: string): Promise<void> {
  await query("DELETE FROM device_tokens WHERE token = $1 AND user_id = $2", [token, userId]);
}

// ─── New photos, in batches ─────────────────────────────────────────────

export const PHOTO_BATCH_MINUTES = 30;

/**
 * A photo just became ready: everyone but its uploader who may see it has one more coming. Owners
 * and co-hosts see everything; members see others' photos only when the event shares them all.
 * Runs in the media workers, so it only writes; the API process sends (flushPhotoBatches).
 */
export async function notePhotoReady(eventId: string, uploaderId: string | null): Promise<void> {
  await query(
    `INSERT INTO photo_push_batches (event_id, user_id, pending)
     SELECT m.event_id, m.user_id, 1
       FROM event_members m JOIN events e ON e.id = m.event_id
      WHERE m.event_id = $1
        -- A photo found in the storage folder (no uploader) is the owner's own.
        AND m.user_id IS DISTINCT FROM COALESCE($2::uuid, e.owner_id)
        AND (m.role <> 'member' OR e.guests_see_all)
     ON CONFLICT (event_id, user_id) DO UPDATE SET pending = photo_push_batches.pending + 1`,
    [eventId, uploaderId],
  );
}

let loop: NodeJS.Timeout | null = null;

/** Sends due photo batches every minute, from the API process. */
export function startPhotoPushLoop(log: { warn: (o: object, m: string) => void }): void {
  if (loop) return;
  loop = setInterval(() => {
    void sendDuePhotoBatches().catch((err) => log.warn({ err }, "push: couldn't send photo batches"));
  }, 60_000);
  loop.unref?.();
}

export function stopPhotoPushLoop(): void {
  if (loop) clearInterval(loop);
  loop = null;
}

/**
 * "12 new photos in Goa" for everyone with some pending whose last one was long enough ago.
 * Claims what's due first (so two processes never send the same batch), then sends it.
 */
export async function sendDuePhotoBatches(now = new Date()): Promise<number> {
  if (!pushAvailable()) return 0;
  const due = await query<{ event_id: string; user_id: string; pending: number; name: string }>(
    `WITH due AS (
       SELECT event_id, user_id, pending FROM photo_push_batches
        WHERE pending > 0 AND (last_sent_at IS NULL OR last_sent_at <= $1::timestamptz - make_interval(mins => $2))
        FOR UPDATE SKIP LOCKED
     ), sent AS (
       UPDATE photo_push_batches b SET pending = 0, last_sent_at = $1
         FROM due WHERE b.event_id = due.event_id AND b.user_id = due.user_id
       RETURNING b.event_id, b.user_id
     )
     SELECT due.event_id, due.user_id, due.pending, e.name
       FROM due JOIN sent USING (event_id, user_id) JOIN events e ON e.id = due.event_id`,
    [now, PHOTO_BATCH_MINUTES],
  );
  for (const batch of due) {
    await pushToUser(batch.user_id, {
      title: `${batch.pending} new ${batch.pending === 1 ? "photo" : "photos"} in ${batch.name}`,
      body: "Tap to see them.",
      data: eventData("PHOTOS_ADDED", batch.event_id),
    });
  }
  return due.length;
}

/** Who to name in a notification. */
export async function displayName(userId: string): Promise<string> {
  const u = await one<{ name: string | null; email: string }>("SELECT name, email FROM users WHERE id = $1", [userId]);
  return u?.name?.trim() || u?.email || "Someone";
}
