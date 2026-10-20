import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import { one, query } from "../db/pool.js";
import { badRequest, forbidden, notFound, parse } from "../lib/errors.js";
import { removeSpool, spoolExists } from "../lib/spool.js";
import { enqueueFaces, enqueueIngest } from "../jobs/queue.js";
import { trashDerivatives } from "../jobs/workers.js";
import { toEvent } from "../realtime/io.js";
import { eventAccess, ownPhotoPredicate } from "../services/access.js";
import { listPhotos, PHOTO_COLUMNS, PHOTO_JOINS, serializePhoto, type PhotoRow } from "../services/photos.js";
import { eventStorage, StorageError } from "../storage/index.js";
import { parseId } from "./shared.js";
import { createZipTicket } from "./media.js";

const listQuery = z.object({
  view: z.enum(["all", "me", "person", "favorites", "uploads", "folder"]).default("all"),
  personId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  order: z.enum(["newest", "oldest"]).default("newest"),
});

const idsBody = z.object({ photoIds: z.array(z.string().uuid()).min(1).max(1000) });

interface VisibleRow {
  id: string;
  event_id: string;
  uploader_id: string | null;
  storage_file_id: string | null;
  thumb_file_id: string | null;
  preview_file_id: string | null;
  spool_path: string | null;
  role: "owner" | "cohost" | "member";
}

/** The subset of `ids` the user may see (with their role in each photo's event). */
async function visiblePhotos(userId: string, ids: string[]): Promise<VisibleRow[]> {
  return query<VisibleRow>(
    `SELECT p.id, p.event_id, p.uploader_id, p.storage_file_id, p.thumb_file_id, p.preview_file_id, p.spool_path, m.role
       FROM photos p
       JOIN events e ON e.id = p.event_id
       JOIN event_members m ON m.event_id = p.event_id AND m.user_id = $1
      WHERE p.id = ANY($2::uuid[])
        AND (m.role <> 'member' OR e.guests_see_all OR ${ownPhotoPredicate("$1")})`,
    [userId, ids],
  );
}

export async function photoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/events/:id/photos", async (req) => {
    const eventId = parseId(req.params);
    const access = await eventAccess(eventId, req.user.id);
    const q = parse(listQuery, req.query);
    const where = ["p.event_id = $2"];
    const params: unknown[] = [eventId];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length + 1}`));
    };
    let ownOnly = !access.canViewAll;

    switch (q.view) {
      case "all":
      case "folder":
        if (!access.canViewAll) throw forbidden("The hosts have hidden the full gallery for this event.");
        if (q.view === "folder") {
          if (!q.folderId) throw badRequest("Pick an album.");
          add((n) => `p.folder_id = ${n}`, q.folderId);
        }
        break;
      case "me":
      case "person": {
        if (!access.canFaceSearch) throw forbidden("Face search is turned off for this event.");
        const person = q.view === "me"
          ? await one<{ id: string }>("SELECT id FROM people WHERE owner_id = $1 AND kind = 'self'", [req.user.id])
          : q.personId
            ? await one<{ id: string }>("SELECT id FROM people WHERE id = $1 AND owner_id = $2", [q.personId, req.user.id])
            : undefined;
        if (!person) throw notFound("Person");
        add((n) => `EXISTS (SELECT 1 FROM photo_matches pm WHERE pm.photo_id = p.id AND pm.person_id = ${n})`, person.id);
        ownOnly = false; // a match is already "theirs"
        break;
      }
      case "favorites":
        where.push("fv.user_id IS NOT NULL");
        ownOnly = false;
        break;
      case "uploads":
        where.push("p.uploader_id = $1");
        ownOnly = false;
        break;
    }

    return listPhotos({
      viewerId: req.user.id,
      where,
      params,
      ownOnly,
      cursor: q.cursor,
      limit: q.limit,
      order: q.order,
    });
  });

  app.get("/api/photos/:id", async (req) => {
    const id = parseId(req.params);
    const [visible] = await visiblePhotos(req.user.id, [id]);
    if (!visible) throw notFound("Photo");
    const row = await one<PhotoRow & { folder_name: string | null }>(
      `SELECT ${PHOTO_COLUMNS}, u.name AS uploader_name, f.name AS folder_name
         FROM photos p ${PHOTO_JOINS}
         LEFT JOIN users u ON u.id = p.uploader_id
         LEFT JOIN folders f ON f.id = p.folder_id
        WHERE p.id = $2`,
      [req.user.id, id],
    );
    const isHost = visible.role !== "member";
    return {
      photo: {
        ...serializePhoto(row!),
        folderName: row!.folder_name,
        canDelete: isHost || visible.uploader_id === req.user.id,
        canSetCover: isHost,
      },
    };
  });

  app.post("/api/photos/favorite", async (req) => {
    const body = parse(idsBody.extend({ favorite: z.boolean() }), req.body);
    const ids = (await visiblePhotos(req.user.id, body.photoIds)).map((p) => p.id);
    if (body.favorite) {
      await query(
        "INSERT INTO favorites (user_id, photo_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING",
        [req.user.id, ids],
      );
    } else {
      await query("DELETE FROM favorites WHERE user_id = $1 AND photo_id = ANY($2::uuid[])", [req.user.id, ids]);
    }
    return { updated: ids.length };
  });

  /**
   * Hosts can delete any photo, guests only their own uploads. The file is
   * moved to the Drive trash / MEGA rubbish bin (recoverable there), otherwise
   * the next sync would bring it straight back.
   */
  app.post("/api/photos/delete", async (req) => {
    const body = parse(idsBody, req.body);
    const rows = (await visiblePhotos(req.user.id, body.photoIds)).filter(
      (p) => p.role !== "member" || p.uploader_id === req.user.id,
    );
    const deleted: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const byEvent = new Map<string, VisibleRow[]>();
    for (const r of rows) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r]);
    for (const [eventId, photos] of byEvent) {
      let storage: Awaited<ReturnType<typeof eventStorage>> | null = null;
      try {
        storage = await eventStorage(eventId);
      } catch {
        storage = null; // storage disconnected: nothing to trash, just drop from InFrame
      }
      for (const p of photos) {
        try {
          if (storage && p.storage_file_id) await storage.provider.trash(p.storage_file_id);
          await trashDerivatives(storage?.provider ?? null, p);
          await removeSpool(p.spool_path); // still waiting to be stored
          deleted.push(p.id);
        } catch (err) {
          failed.push({ id: p.id, error: err instanceof StorageError ? err.message : "Couldn't delete from storage." });
        }
      }
      const ids = photos.map((p) => p.id).filter((id) => deleted.includes(id));
      if (ids.length) toEvent(eventId, "photos:deleted", { eventId, photoIds: ids });
    }
    if (deleted.length) await query("DELETE FROM photos WHERE id = ANY($1::uuid[])", [deleted]);
    return { deleted, failed, skipped: body.photoIds.length - deleted.length - failed.length };
  });

  /** Retry a failed upload/processing step (uploader or host). */
  app.post("/api/photos/:id/retry", async (req) => {
    const id = parseId(req.params);
    const photo = await one<{ id: string; event_id: string; uploader_id: string | null; status: string; face_status: string }>(
      "SELECT id, event_id, uploader_id, status, face_status FROM photos WHERE id = $1",
      [id],
    );
    if (!photo) throw notFound("Photo");
    const access = await eventAccess(photo.event_id, req.user.id);
    if (!access.isHost && photo.uploader_id !== req.user.id) throw forbidden();
    if (photo.status === "failed") {
      // An upload that never reached storage needs its copy still waiting on the server.
      const row = await one<{ storage_file_id: string | null; spool_path: string | null }>(
        "SELECT storage_file_id, spool_path FROM photos WHERE id = $1",
        [id],
      );
      if (!row?.storage_file_id && !spoolExists(row?.spool_path)) {
        throw badRequest("This upload can't be retried — add the file again.");
      }
      await query("UPDATE photos SET status = 'pending', error = NULL WHERE id = $1", [id]);
      await enqueueIngest({ photoId: id });
    } else if (photo.face_status === "failed") {
      await query("UPDATE photos SET face_status = 'pending', error = NULL WHERE id = $1", [id]);
      await enqueueFaces({ photoId: id });
    }
    return { ok: true };
  });

  /** Upload status for photos the caller is tracking on the upload screen. */
  app.post("/api/photos/status", async (req) => {
    const body = parse(idsBody, req.body);
    const rows = await query(
      `SELECT p.id, p.status, p.media_type AS "mediaType", p.face_status AS "faceStatus", p.face_count AS "faceCount", p.error,
              (SELECT count(*)::int FROM photo_matches pm WHERE pm.photo_id = p.id) AS "matchCount"
         FROM photos p WHERE p.id = ANY($1::uuid[]) AND p.uploader_id = $2`,
      [body.photoIds, req.user.id],
    );
    return { photos: rows };
  });

  /** "My photos" across every event: matches of one of my people (default: me). */
  app.get("/api/me/photos", async (req) => {
    const q = parse(
      z.object({
        personId: z.string().uuid().optional(),
        cursor: z.string().max(300).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(60),
      }),
      req.query,
    );
    const person = q.personId
      ? await one<{ id: string }>("SELECT id FROM people WHERE id = $1 AND owner_id = $2", [q.personId, req.user.id])
      : await one<{ id: string }>("SELECT id FROM people WHERE owner_id = $1 AND kind = 'self'", [req.user.id]);
    if (!person) throw notFound("Person");
    return listPhotos({
      viewerId: req.user.id,
      where: [
        "EXISTS (SELECT 1 FROM photo_matches pm WHERE pm.photo_id = p.id AND pm.person_id = $2)",
        `p.event_id IN (SELECT m.event_id FROM event_members m JOIN events ev ON ev.id = m.event_id
                         WHERE m.user_id = $1 AND (m.role <> 'member' OR ev.face_search))`,
      ],
      params: [person.id],
      withEvent: true,
      cursor: q.cursor,
      limit: q.limit,
      order: "newest",
    });
  });

  /** Returns a one-time link that streams the originals as a ZIP. */
  app.post("/api/downloads", async (req) => {
    const body = parse(z.object({ photoIds: z.array(z.string().uuid()).min(1).max(500, "Download up to 500 photos at a time.") }), req.body);
    const rows = await visiblePhotos(req.user.id, body.photoIds);
    if (!rows.length) throw notFound("Those photos");
    return { url: createZipTicket(req.user.id, rows.map((r) => r.id)) };
  });
}
