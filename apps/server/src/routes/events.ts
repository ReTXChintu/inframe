import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { one, query, tx } from "../db/pool.js";
import { joinCode } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/errors.js";
import { photoUrl } from "../lib/media-urls.js";
import { enqueueFaces, enqueueIngest, enqueueSync } from "../jobs/queue.js";
import { toEvent } from "../realtime/io.js";
import {
  eventAccess,
  guestLimits,
  guestUsage,
  hostAccess,
  ownerAccess,
  storagePendingError,
  type EventAccess,
  type EventRow,
  type Role,
} from "../services/access.js";
import { loadConnection } from "../storage/index.js";
import { parseId, PERSON_COLUMNS, serializePerson, type PersonRow } from "./shared.js";
import { ownConnection, pickFolder } from "./storage.js";

const KINDS = ["trip", "wedding", "party", "other"] as const;
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .nullable()
  .optional()
  .transform((v) => v || null);

const eventFields = {
  name: z.string().trim().min(1, "Give the event a name.").max(100),
  kind: z.enum(KINDS),
  startsOn: isoDate,
  endsOn: isoDate,
};

const storageChoice = z.object({
  connectionId: z.string().uuid("Pick where photos are stored."),
  /** Share link / URL / path of an existing folder. Empty = create a new folder. */
  folder: z.string().trim().max(500).optional().nullable(),
});

function checkDates(startsOn: string | null | undefined, endsOn: string | null | undefined) {
  if (startsOn && endsOn && endsOn < startsOn) throw badRequest("The end date is before the start date.");
}

export async function uniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = joinCode();
    if (!(await one("SELECT 1 FROM events WHERE join_code = $1", [code]))) return code;
  }
  throw new Error("Could not allocate a join code");
}

const coverUrl = (photoId: string | null) => (photoId ? photoUrl(photoId, "thumb") : null);

/** The app (Trippin) this event is linked to, if any — `linked: false` once it was unlinked. */
const externalLink = (e: Pick<EventRow, "external_source" | "external_url" | "external_linked">) =>
  e.external_source ? { source: e.external_source, url: e.external_url, linked: e.external_linked === true } : null;

/** No storage folder picked yet (an event Trippin created starts like this): nothing can be added until the owner picks one. */
const storagePending = (e: Pick<EventRow, "storage_folder_id">) => !e.storage_folder_id;

interface Counts {
  all: number;
  me: number;
  favorites: number;
  uploads: number;
  members: number;
  failed: number;
  processing: number;
}

async function eventDetail(access: EventAccess, userId: string) {
  const e = access.event;
  const counts = (await one<Counts>(
    `SELECT
       (SELECT count(*)::int FROM photos p WHERE p.event_id = $1 AND p.status = 'ready') AS all,
       (SELECT count(*)::int FROM photo_matches pm JOIN photos p ON p.id = pm.photo_id
          JOIN people pp ON pp.id = pm.person_id
         WHERE p.event_id = $1 AND p.status = 'ready' AND pp.owner_id = $2 AND pp.kind = 'self') AS me,
       (SELECT count(*)::int FROM favorites f JOIN photos p ON p.id = f.photo_id
         WHERE p.event_id = $1 AND p.status = 'ready' AND f.user_id = $2) AS favorites,
       (SELECT count(*)::int FROM photos p WHERE p.event_id = $1 AND p.status = 'ready' AND p.uploader_id = $2) AS uploads,
       (SELECT count(*)::int FROM event_members m WHERE m.event_id = $1) AS members,
       (SELECT count(*)::int FROM photos p WHERE p.event_id = $1 AND (p.status = 'failed' OR p.face_status = 'failed')) AS failed,
       (SELECT count(*)::int FROM photos p WHERE p.event_id = $1
          AND (p.status IN ('pending', 'processing') OR (p.status = 'ready' AND p.face_status IN ('pending', 'processing')))) AS processing`,
    [e.id, userId],
  ))!;

  const folders = access.canViewAll
    ? await query<{ id: string; name: string; count: number }>(
        `SELECT f.id, f.name, count(p.id)::int AS count
           FROM folders f LEFT JOIN photos p ON p.folder_id = f.id AND p.status = 'ready'
          WHERE f.event_id = $1 GROUP BY f.id ORDER BY lower(f.name)`,
        [e.id],
      )
    : [];

  const people = await query<PersonRow & { event_count: number }>(
    `SELECT ${PERSON_COLUMNS},
            (SELECT count(*)::int FROM photo_matches pm JOIN photos p ON p.id = pm.photo_id
              WHERE pm.person_id = pp.id AND p.event_id = $2 AND p.status = 'ready') AS event_count
       FROM people pp WHERE pp.owner_id = $1
      ORDER BY (pp.kind = 'self') DESC, pp.created_at`,
    [userId, e.id],
  );

  const storage = e.storage_connection_id
    ? await one<{ provider: string; account_label: string; status: string; last_error: string | null; user_id: string }>(
        "SELECT provider, account_label, status, last_error, user_id FROM storage_connections WHERE id = $1",
        [e.storage_connection_id],
      )
    : undefined;
  const owner = await one<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = $1", [e.owner_id]);

  // A guest sees how much of the event's per-guest allowance they have left; hosts have no cap.
  const limits = guestLimits(e);
  const guestAllowance = access.isHost ? null : { ...limits, ...(await guestUsage(e.id, userId)) };

  const autoCover = access.canViewAll && !e.cover_photo_id
    ? (await one<{ id: string }>(
        "SELECT id FROM photos WHERE event_id = $1 AND status = 'ready' ORDER BY sort_at DESC LIMIT 1",
        [e.id],
      ))?.id ?? null
    : null;

  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    createdAt: e.created_at,
    owner,
    role: access.role,
    isHost: access.isHost,
    isOwner: access.isOwner,
    can: {
      viewAll: access.canViewAll,
      upload: access.canUpload && Boolean(storage && e.storage_folder_id),
      faceSearch: access.canFaceSearch,
    },
    settings: {
      joinEnabled: e.join_enabled,
      guestUploads: e.guest_uploads,
      guestsSeeAll: e.guests_see_all,
      faceSearch: e.face_search,
      // Per guest, in all. null = no limit.
      guestMaxItems: limits.maxItems,
      guestMaxBytes: limits.maxBytes,
    },
    guestAllowance,
    joinCode: access.isHost || e.join_enabled ? e.join_code : null,
    coverPhotoId: e.cover_photo_id,
    coverUrl: coverUrl(e.cover_photo_id ?? autoCover),
    external: externalLink(e),
    storage: {
      connected: Boolean(storage && e.storage_folder_id),
      pending: storagePending(e),
      provider: storage?.provider ?? null,
      folderName: e.storage_folder_name,
      // Account and link details are for hosts only.
      accountLabel: access.isHost ? (storage?.account_label ?? null) : null,
      folderUrl: access.isHost ? e.storage_folder_url : null,
      connectionId: access.isOwner ? e.storage_connection_id : null,
      status: storage?.status ?? null,
      error: access.isHost ? (storage?.last_error ?? null) : null,
      syncState: e.sync_state,
      syncError: access.isHost ? e.sync_error : null,
      lastSyncedAt: e.last_synced_at,
    },
    counts: {
      all: access.canViewAll ? counts.all : null,
      me: counts.me,
      favorites: counts.favorites,
      uploads: counts.uploads,
      members: counts.members,
      failed: access.isHost ? counts.failed : null,
      processing: access.isHost ? counts.processing : null,
    },
    folders,
    people: people.map((p) => ({ ...serializePerson(p), eventCount: p.event_count })),
  };
}

export async function eventRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/events", async (req) => {
    const rows = await query<EventRow & {
      role: Role;
      photo_count: number;
      member_count: number;
      my_count: number;
      cover_id: string | null;
      provider: string | null;
    }>(
      `SELECT e.*, m.role,
              (SELECT count(*)::int FROM photos p WHERE p.event_id = e.id AND p.status = 'ready') AS photo_count,
              (SELECT count(*)::int FROM event_members mm WHERE mm.event_id = e.id) AS member_count,
              (SELECT count(*)::int FROM photo_matches pm JOIN photos p ON p.id = pm.photo_id
                 JOIN people pp ON pp.id = pm.person_id
                WHERE p.event_id = e.id AND p.status = 'ready' AND pp.owner_id = $1 AND pp.kind = 'self') AS my_count,
              COALESCE(e.cover_photo_id, CASE WHEN m.role <> 'member' OR e.guests_see_all THEN
                (SELECT p.id FROM photos p WHERE p.event_id = e.id AND p.status = 'ready' ORDER BY p.sort_at DESC LIMIT 1)
              END) AS cover_id,
              c.provider
         FROM events e
         JOIN event_members m ON m.event_id = e.id AND m.user_id = $1
         LEFT JOIN storage_connections c ON c.id = e.storage_connection_id
        ORDER BY COALESCE(e.starts_on, e.created_at::date) DESC, e.created_at DESC`,
      [req.user.id],
    );
    return {
      events: rows.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        startsOn: e.starts_on,
        endsOn: e.ends_on,
        createdAt: e.created_at,
        role: e.role,
        photoCount: e.photo_count,
        memberCount: e.member_count,
        myCount: e.my_count,
        coverUrl: coverUrl(e.cover_id),
        provider: e.provider,
        storagePending: storagePending(e),
        external: externalLink(e),
      })),
    };
  });

  app.post("/api/events", async (req, reply) => {
    const body = parse(z.object({ ...eventFields, storage: storageChoice }), req.body);
    checkDates(body.startsOn, body.endsOn);
    const conn = await ownConnection(body.storage.connectionId, req.user.id);
    const { folder, created } = await pickFolder(conn, req.user.id, {
      folder: body.storage.folder,
      createNamed: `InFrame · ${body.name}`,
    });
    const code = await uniqueJoinCode();
    const event = await tx(async (db) => {
      const row = await one<{ id: string }>(
        `INSERT INTO events (owner_id, name, kind, starts_on, ends_on, join_code,
                             storage_connection_id, storage_folder_id, storage_folder_name, storage_folder_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [req.user.id, body.name, body.kind, body.startsOn, body.endsOn, code, conn.id, folder.id, folder.name, folder.url],
        db,
      );
      await db.query("INSERT INTO event_members (event_id, user_id, role) VALUES ($1, $2, 'owner')", [row!.id, req.user.id]);
      return row!;
    });
    // An existing folder may already hold photos — index them.
    if (!created) await enqueueSync(event.id);
    reply.code(201);
    return { event: await eventDetail(await eventAccess(event.id, req.user.id), req.user.id) };
  });

  app.get("/api/events/:id", async (req) => {
    const access = await eventAccess(parseId(req.params), req.user.id);
    return { event: await eventDetail(access, req.user.id) };
  });

  app.patch("/api/events/:id", async (req) => {
    const id = parseId(req.params);
    const access = await hostAccess(id, req.user.id);
    const body = parse(
      z.object({
        ...eventFields,
        joinEnabled: z.boolean(),
        guestUploads: z.boolean(),
        guestsSeeAll: z.boolean(),
        faceSearch: z.boolean(),
        coverPhotoId: z.string().uuid().nullable(),
        // Per-guest upload caps; null lifts one. The owner's call, not a co-host's.
        guestMaxItems: z.number().int().min(1, "At least 1 photo.").max(1_000_000).nullable(),
        guestMaxBytes: z.number().int().min(1024 * 1024, "At least 1 MB.").max(1024 ** 5).nullable(),
      }).partial(),
      req.body,
    );
    if ((body.guestMaxItems !== undefined || body.guestMaxBytes !== undefined) && !access.isOwner) {
      throw forbidden("Only the event owner can change what guests may upload.");
    }
    checkDates(
      body.startsOn !== undefined ? body.startsOn : access.event.starts_on,
      body.endsOn !== undefined ? body.endsOn : access.event.ends_on,
    );
    if (body.coverPhotoId && !(await one("SELECT 1 FROM photos WHERE id = $1 AND event_id = $2", [body.coverPhotoId, id]))) {
      throw badRequest("That photo isn't in this event.");
    }
    const columns: Record<string, unknown> = {
      name: body.name,
      kind: body.kind,
      starts_on: body.startsOn,
      ends_on: body.endsOn,
      join_enabled: body.joinEnabled,
      guest_uploads: body.guestUploads,
      guests_see_all: body.guestsSeeAll,
      face_search: body.faceSearch,
      cover_photo_id: body.coverPhotoId,
      guest_max_items: body.guestMaxItems,
      guest_max_bytes: body.guestMaxBytes,
    };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [col, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length) await query(`UPDATE events SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    toEvent(id, "event:updated", { eventId: id });
    return { event: await eventDetail(await eventAccess(id, req.user.id), req.user.id) };
  });

  /** Point the event at a different folder/account. Photos from the old folder are dropped and the new one is indexed. */
  app.put("/api/events/:id/storage", async (req) => {
    const id = parseId(req.params);
    const access = await ownerAccess(id, req.user.id);
    const body = parse(storageChoice, req.body);
    const conn = await ownConnection(body.connectionId, req.user.id);
    const { folder, created } = await pickFolder(conn, req.user.id, {
      folder: body.folder,
      createNamed: `InFrame · ${access.event.name}`,
    });
    // A pending event (no folder yet) has nothing to drop: albums made meanwhile carry over.
    const replacing = Boolean(access.event.storage_folder_id) && folder.id !== access.event.storage_folder_id;
    let dropped = 0;
    await tx(async (db) => {
      if (replacing) {
        // The old folder (and its .inframe previews) stays untouched in storage.
        dropped = (await db.query("DELETE FROM photos WHERE event_id = $1", [id])).rowCount ?? 0;
        await db.query("DELETE FROM folders WHERE event_id = $1", [id]);
      }
      await db.query(
        `UPDATE events SET storage_connection_id = $2, storage_folder_id = $3, storage_folder_name = $4,
                storage_folder_url = $5, sync_state = 'idle', sync_error = NULL, updated_at = now()
          WHERE id = $1`,
        [id, conn.id, folder.id, folder.name, folder.url],
      );
    });
    if (!created) await enqueueSync(id);
    toEvent(id, "event:updated", { eventId: id });
    return { event: await eventDetail(await eventAccess(id, req.user.id), req.user.id), removedPhotos: dropped };
  });

  app.post("/api/events/:id/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    const id = parseId(req.params);
    const access = await hostAccess(id, req.user.id);
    if (!access.event.storage_folder_id || !access.event.storage_connection_id) throw storagePendingError(access.isOwner);
    const conn = await loadConnection(access.event.storage_connection_id);
    if (conn.status === "error") throw badRequest("The storage account needs reconnecting before it can sync.");
    await enqueueSync(id);
    await query("UPDATE events SET sync_state = 'syncing' WHERE id = $1", [id]);
    toEvent(id, "event:sync", { eventId: id, state: "syncing" });
    return { ok: true };
  });

  /** Re-run work for photos that failed, or (scope=all) face detection for every photo. */
  app.post("/api/events/:id/reprocess", async (req) => {
    const id = parseId(req.params);
    await hostAccess(id, req.user.id);
    const { scope } = parse(z.object({ scope: z.enum(["failed", "all"]).default("failed") }), req.body ?? {});
    const ingest = await query<{ id: string }>(
      "UPDATE photos SET status = 'pending', error = NULL WHERE event_id = $1 AND status = 'failed' RETURNING id",
      [id],
    );
    const faces = await query<{ id: string }>(
      `UPDATE photos SET face_status = 'pending', error = NULL
        WHERE event_id = $1 AND status = 'ready' ${scope === "failed" ? "AND face_status = 'failed'" : ""}
        RETURNING id`,
      [id],
    );
    for (const p of ingest) await enqueueIngest({ photoId: p.id });
    for (const p of faces) await enqueueFaces({ photoId: p.id });
    return { queued: ingest.length + faces.length };
  });

  app.post("/api/events/:id/join-code", async (req) => {
    const id = parseId(req.params);
    await hostAccess(id, req.user.id);
    const code = await uniqueJoinCode();
    await query("UPDATE events SET join_code = $2, updated_at = now() WHERE id = $1", [id, code]);
    return { joinCode: code };
  });

  /** Removes the event from InFrame. Files in Drive/MEGA are left untouched. */
  app.delete("/api/events/:id", async (req) => {
    const id = parseId(req.params);
    await ownerAccess(id, req.user.id);
    await query("DELETE FROM events WHERE id = $1", [id]);
    toEvent(id, "event:deleted", { eventId: id });
    return { ok: true };
  });

  // ─── Albums ────────────────────────────────────────────────────────────
  const folderName = z.object({ name: z.string().trim().min(1, "Name the album.").max(80) });

  app.post("/api/events/:id/folders", async (req, reply) => {
    const id = parseId(req.params);
    await hostAccess(id, req.user.id);
    const { name } = parse(folderName, req.body);
    const row = await one<{ id: string; name: string }>(
      "INSERT INTO folders (event_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name",
      [id, name],
    );
    if (!row) throw conflict("There's already an album with that name.");
    toEvent(id, "event:updated", { eventId: id });
    reply.code(201);
    return { folder: { ...row, count: 0 } };
  });

  app.patch("/api/folders/:id", async (req) => {
    const folderId = parseId(req.params);
    const folder = await one<{ event_id: string }>("SELECT event_id FROM folders WHERE id = $1", [folderId]);
    if (!folder) throw notFound("Album");
    await hostAccess(folder.event_id, req.user.id);
    const { name } = parse(folderName, req.body);
    const clash = await one("SELECT 1 FROM folders WHERE event_id = $1 AND lower(name) = lower($2) AND id <> $3", [
      folder.event_id,
      name,
      folderId,
    ]);
    if (clash) throw conflict("There's already an album with that name.");
    await query("UPDATE folders SET name = $2 WHERE id = $1", [folderId, name]);
    toEvent(folder.event_id, "event:updated", { eventId: folder.event_id });
    return { ok: true };
  });

  /** Deletes the album only; its photos stay in the event (and the sub-folder stays in storage). */
  app.delete("/api/folders/:id", async (req) => {
    const folderId = parseId(req.params);
    const folder = await one<{ event_id: string }>("SELECT event_id FROM folders WHERE id = $1", [folderId]);
    if (!folder) throw notFound("Album");
    await hostAccess(folder.event_id, req.user.id);
    await query("DELETE FROM folders WHERE id = $1", [folderId]);
    toEvent(folder.event_id, "event:updated", { eventId: folder.event_id });
    return { ok: true };
  });
}
