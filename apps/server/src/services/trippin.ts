import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { one, query, tx, type Queryable } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import { photoUrl } from "../lib/media-urls.js";
import { evictFromEvent, toEvent, toUser } from "../realtime/io.js";
import { userFromIdentity } from "../routes/auth.js";
import { uniqueJoinCode } from "../routes/events.js";
import type { Role } from "./access.js";
import { clearMemberMatches, matchMemberInEvent } from "./matching.js";

/*
 * Trippin (the suite's trip planner) links a trip to an InFrame event when
 * its owner switches on "Share photos in InFrame". From then on Trippin keeps
 * the event's name, dates and members in step and reads a live summary.
 * Switching it off only unlinks: the event and its photos stay as a normal event.
 *
 * Roles: Trippin owner → owner, editor → cohost, viewer → member.
 *   - Only the trip's owner becomes the event's owner (when the event is
 *     created). Ownership never moves afterwards: the owner's own Drive/MEGA
 *     holds the photos. If the trip changes hands, the new trip owner is a co-host.
 *   - Trippin's member changes only remove members Trippin added. People who
 *     joined in InFrame (code, link, invite) stay, and only ever gain a role from it.
 */

export const SOURCE = "trippin";

export interface SuitePerson {
  sub: string;
  email: string;
  name?: string | null;
}

export type TrippinRole = "owner" | "editor" | "viewer";

export interface TrippinTrip {
  id: string;
  title: string;
  startDate?: string | null;
  endDate?: string | null;
  destination?: string | null;
  url?: string | null;
  owner: SuitePerson;
  members: (SuitePerson & { role: TrippinRole })[];
}

export type TrippinEventType = "trip.linked" | "trip.updated" | "trip.members_changed" | "trip.unlinked";

export interface TrippinDelivery {
  id: string;
  type: TrippinEventType;
  trip: { id: string } & Partial<TrippinTrip>;
}

const ROLE: Record<TrippinRole, Exclude<Role, "owner">> = { owner: "cohost", editor: "cohost", viewer: "member" };

export const eventWebUrl = (eventId: string) => `${config.appUrl}/events/${eventId}`;

/**
 * The InFrame account for someone Trippin names, made just in time when they
 * have never signed in to InFrame. Creation goes through the sign-in module's
 * own `userFromIdentity`, so it gets the same "self" person row and first-user
 * admin as a first sign-in. Trippin vouches for the sub/email pair (it only
 * knows people who signed in through the shared identity server).
 *
 * An existing account is never claimed by email from here: that only happens
 * when its owner signs in themselves. Such people (and emails that belong to a
 * different account) are skipped (null) until then.
 */
async function suiteUser(person: SuitePerson, log?: FastifyBaseLogger): Promise<string | null> {
  const linked = await one<{ id: string }>("SELECT id FROM users WHERE oidc_sub = $1", [person.sub]);
  if (linked) return linked.id;
  const email = person.email.trim().toLowerCase();
  if (await one("SELECT 1 FROM users WHERE email = $1", [email])) {
    log?.info({ sub: person.sub }, "trippin: account with this email isn't linked to the identity yet; skipped");
    return null;
  }
  try {
    const { user } = await userFromIdentity({
      sub: person.sub,
      email,
      emailVerified: true,
      name: person.name?.trim() || null,
      picture: null,
    });
    return user.id;
  } catch (err) {
    // Lost a race with a sign-in for the same email, or similar: skip rather than fail the trip.
    if (err instanceof AppError) {
      log?.warn({ sub: person.sub, code: err.code }, "trippin: couldn't create an account just in time");
      return null;
    }
    throw err;
  }
}

interface Wanted {
  userId: string;
  role: Exclude<Role, "owner">;
}

/** Trip members (and the trip owner) as InFrame accounts with mapped roles. Unresolvable people are left out. */
async function wantedMembers(trip: TrippinTrip, log?: FastifyBaseLogger): Promise<Wanted[]> {
  const people = [{ ...trip.owner, role: "owner" as const }, ...trip.members];
  const out = new Map<string, Wanted>();
  for (const p of people) {
    const userId = await suiteUser(p, log);
    if (!userId) continue;
    const role = ROLE[p.role];
    // Someone listed twice keeps the stronger role.
    if (out.get(userId)?.role !== "cohost") out.set(userId, { userId, role });
  }
  return [...out.values()];
}

interface MemberChanges {
  added: string[];
  removed: string[];
  changed: boolean;
}

/**
 * Bring the event's members in line with the trip. The owner's row is never
 * touched; removals only apply to members Trippin added.
 */
async function syncMembers(db: Queryable, eventId: string, ownerId: string, wanted: Wanted[]): Promise<MemberChanges> {
  const result: MemberChanges = { added: [], removed: [], changed: false };
  for (const m of wanted) {
    if (m.userId === ownerId) continue;
    const row = await one<{ fresh: boolean; changed: boolean }>(
      `WITH before AS (SELECT role FROM event_members WHERE event_id = $1 AND user_id = $2)
       INSERT INTO event_members AS em (event_id, user_id, role, source) VALUES ($1, $2, $3, 'trippin')
       ON CONFLICT (event_id, user_id) DO UPDATE
         SET role = CASE
               WHEN em.role = 'owner' THEN 'owner'
               WHEN em.source = 'trippin' THEN EXCLUDED.role
               WHEN em.role = 'member' AND EXCLUDED.role = 'cohost' THEN 'cohost'
               ELSE em.role
             END
       RETURNING (xmax = 0) AS fresh, em.role IS DISTINCT FROM (SELECT role FROM before) AS changed`,
      [eventId, m.userId, m.role],
      db,
    );
    if (row?.fresh) result.added.push(m.userId);
    if (row?.changed) result.changed = true;
  }
  const keep = [ownerId, ...wanted.map((m) => m.userId)];
  const gone = await query<{ user_id: string }>(
    `DELETE FROM event_members
      WHERE event_id = $1 AND source = 'trippin' AND role <> 'owner' AND NOT (user_id = ANY($2::uuid[]))
      RETURNING user_id`,
    [eventId, keep],
    db,
  );
  for (const g of gone) {
    await clearMemberMatches(g.user_id, eventId, db);
    result.removed.push(g.user_id);
  }
  if (result.added.length || result.removed.length) result.changed = true;
  return result;
}

const tripName = (title: string) => title.trim().slice(0, 100) || "Trip";
const tripDates = (trip: Partial<TrippinTrip>) => {
  const start = trip.startDate || null;
  let end = trip.endDate || null;
  // InFrame never stores an end before the start.
  if (start && end && end < start) end = null;
  return { start, end };
};

interface Applied {
  response: Record<string, unknown>;
  eventId: string | null;
  members: MemberChanges | null;
}

/**
 * Apply one Trippin delivery, exactly once per delivery id. A repeated
 * delivery gets the stored response back and changes nothing.
 */
export async function handleTrippinEvent(delivery: TrippinDelivery, log?: FastifyBaseLogger): Promise<Record<string, unknown>> {
  const already = await one<{ response: Record<string, unknown> }>(
    "SELECT response FROM integration_events WHERE source = $1 AND id = $2",
    [SOURCE, delivery.id],
  );
  if (already) return already.response;

  const trip = delivery.trip as TrippinTrip;
  // Accounts (just-in-time ones included) and a join code are settled before
  // the transaction: they use their own connections.
  const linking = delivery.type === "trip.linked";
  const ownerId = linking ? await suiteUser(trip.owner, log) : null;
  if (linking && !ownerId) {
    throw new AppError(409, "owner_unavailable", "The trip owner's InFrame account can't be set up automatically. Ask them to sign in to InFrame once.");
  }
  const wanted = linking || delivery.type === "trip.members_changed" ? await wantedMembers(trip, log) : [];
  const joinCode = linking ? await uniqueJoinCode() : null;

  const applied = await tx<Applied>(async (db) => {
    // One delivery for a trip at a time, and the duplicate check under the same lock.
    await db.query("SELECT pg_advisory_xact_lock(727003, hashtext($1))", [trip.id]);
    const seen = await one<{ response: Record<string, unknown> }>(
      "SELECT response FROM integration_events WHERE source = $1 AND id = $2",
      [SOURCE, delivery.id],
      db,
    );
    if (seen) return { response: seen.response, eventId: null, members: null };

    const existing = await one<{ id: string; owner_id: string; external_linked: boolean | null }>(
      "SELECT id, owner_id, external_linked FROM events WHERE external_source = $1 AND external_id = $2",
      [SOURCE, trip.id],
      db,
    );
    let result: Applied = { response: {}, eventId: existing?.id ?? null, members: null };

    if (delivery.type === "trip.linked") {
      const { start, end } = tripDates(trip);
      let eventId: string;
      let eventOwner: string;
      if (existing) {
        // Linked before (and maybe unlinked since): link it again and catch up.
        eventId = existing.id;
        eventOwner = existing.owner_id;
        await db.query(
          `UPDATE events SET external_linked = true, external_url = $2, name = $3, starts_on = $4, ends_on = $5,
                  updated_at = now()
            WHERE id = $1`,
          [eventId, trip.url ?? null, tripName(trip.title), start, end],
        );
      } else {
        // No storage yet: the owner picks a Drive/MEGA folder in InFrame.
        const row = await one<{ id: string }>(
          `INSERT INTO events (owner_id, name, kind, starts_on, ends_on, join_code,
                               external_source, external_id, external_url, external_linked)
           VALUES ($1, $2, 'trip', $3, $4, $5, $6, $7, $8, true) RETURNING id`,
          [ownerId, tripName(trip.title), start, end, joinCode, SOURCE, trip.id, trip.url ?? null],
          db,
        );
        eventId = row!.id;
        eventOwner = ownerId!;
        await db.query("INSERT INTO event_members (event_id, user_id, role, source) VALUES ($1, $2, 'owner', 'trippin')", [
          eventId,
          eventOwner,
        ]);
      }
      const members = await syncMembers(db, eventId, eventOwner, wanted);
      result = { response: { remoteId: eventId, url: eventWebUrl(eventId) }, eventId, members };
    } else if (existing?.external_linked) {
      // Changes for an unlinked (or never linked) trip don't touch the event.
      if (delivery.type === "trip.updated") {
        const { start, end } = tripDates(trip);
        await db.query(
          `UPDATE events SET name = $2, starts_on = $3, ends_on = $4, external_url = COALESCE($5, external_url),
                  updated_at = now()
            WHERE id = $1`,
          [existing.id, tripName(trip.title ?? ""), start, end, trip.url ?? null],
        );
      } else if (delivery.type === "trip.members_changed") {
        result.members = await syncMembers(db, existing.id, existing.owner_id, wanted);
      } else if (delivery.type === "trip.unlinked") {
        // Unlink only: the event, its members and photos all stay.
        await db.query("UPDATE events SET external_linked = false, updated_at = now() WHERE id = $1", [existing.id]);
      }
    }

    await db.query("INSERT INTO integration_events (source, id, type, response) VALUES ($1, $2, $3, $4)", [
      SOURCE,
      delivery.id,
      delivery.type,
      JSON.stringify(result.response),
    ]);
    return result;
  });

  // After commit: realtime updates, and find new members in the photos (as joining does).
  const { eventId, members } = applied;
  if (eventId) {
    toEvent(eventId, "event:updated", { eventId });
    if (members?.changed) toEvent(eventId, "event:members", { eventId });
    for (const userId of members?.removed ?? []) {
      evictFromEvent(userId, eventId);
      toUser(userId, "event:removed", { eventId });
    }
    for (const userId of members?.added ?? []) {
      await matchMemberInEvent(userId, eventId);
      toUser(userId, "event:updated", { eventId });
    }
  }
  return applied.response;
}

export interface TripSummary {
  linked: true;
  url: string;
  photoCount: number;
  videoCount: number;
  albumCount: number;
  coverThumbUrl: string | null;
  needsStorage: boolean;
  updatedAt: Date;
}

/** What Trippin shows on the trip page. Null when no event is linked to the trip. */
export async function tripSummary(tripId: string, viewerSub?: string | null): Promise<TripSummary | null> {
  const e = await one<{
    id: string;
    cover_photo_id: string | null;
    guests_see_all: boolean;
    needs_storage: boolean;
    photo_count: number;
    video_count: number;
    album_count: number;
    updated_at: Date;
  }>(
    `SELECT e.id, e.cover_photo_id, e.guests_see_all,
            (e.storage_folder_id IS NULL OR e.storage_connection_id IS NULL) AS needs_storage,
            (SELECT count(*)::int FROM photos p WHERE p.event_id = e.id AND p.status = 'ready' AND p.media_type = 'image') AS photo_count,
            (SELECT count(*)::int FROM photos p WHERE p.event_id = e.id AND p.status = 'ready' AND p.media_type = 'video') AS video_count,
            (SELECT count(*)::int FROM folders f WHERE f.event_id = e.id) AS album_count,
            GREATEST(e.updated_at, (SELECT max(p.updated_at) FROM photos p WHERE p.event_id = e.id)) AS updated_at
       FROM events e
      WHERE e.external_source = $1 AND e.external_id = $2 AND e.external_linked`,
    [SOURCE, tripId],
  );
  if (!e) return null;

  // The cover only for a member, and only a photo they may see (as in their events list).
  let coverId: string | null = null;
  if (viewerSub) {
    const viewer = await one<{ role: Role }>(
      `SELECT m.role FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1 AND u.oidc_sub = $2`,
      [e.id, viewerSub],
    );
    if (viewer) {
      coverId = e.cover_photo_id;
      if (!coverId && (viewer.role !== "member" || e.guests_see_all)) {
        coverId = (await one<{ id: string }>(
          "SELECT id FROM photos WHERE event_id = $1 AND status = 'ready' ORDER BY sort_at DESC LIMIT 1",
          [e.id],
        ))?.id ?? null;
      }
    }
  }

  return {
    linked: true,
    url: eventWebUrl(e.id),
    photoCount: e.photo_count,
    videoCount: e.video_count,
    albumCount: e.album_count,
    coverThumbUrl: coverId ? `${config.appUrl}${photoUrl(coverId, "thumb")}` : null,
    needsStorage: e.needs_storage,
    updatedAt: e.updated_at,
  };
}

export async function suiteUserExists(sub: string) {
  return Boolean(await one("SELECT 1 FROM users WHERE oidc_sub = $1", [sub]));
}
