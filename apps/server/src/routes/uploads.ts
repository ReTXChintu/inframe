import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireUser, userFromToken, type AuthUser } from "../auth/guard.js";
import { signState, verifyState } from "../auth/tokens.js";
import { one, query } from "../db/pool.js";
import { AppError, badRequest, forbidden, parse, unauthorized } from "../lib/errors.js";
import { mediaTypeOf, mimeFor } from "../lib/images.js";
import { ensureSpool, newSpoolPath, removeSpool } from "../lib/spool.js";
import { enqueueIngest } from "../jobs/queue.js";
import { eventAccess, guestLimitError, guestLimits, guestUsage, storagePendingError } from "../services/access.js";
import { serializePhoto, type PhotoRow } from "../services/photos.js";
import { parseId } from "./shared.js";

/*
 * Uploads land on the server first: the file is streamed to the spool and
 * queued, and the request answers as soon as the bytes are in. A worker
 * process then stores it in the event's Drive/MEGA folder, makes previews
 * and (for photos) scans faces. The phone or browser only has to deliver the
 * bytes — it doesn't wait for storage or face matching.
 */

const UPLOAD_TICKET_TTL = "24h";

/** Make an uploaded file name safe to store in Drive/MEGA. */
export function cleanName(name: string | undefined) {
  const base = path.basename(name || "photo.jpg").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return (base || "photo.jpg").slice(0, 180);
}

/**
 * Who's uploading: a normal access token, or an upload ticket. Tickets let
 * the Android app keep uploading in the background for hours, long after a
 * 15-minute access token would have expired. A ticket is tied to one user and
 * one event, and stops working if the user changes their password.
 */
async function uploader(req: FastifyRequest, eventId: string): Promise<AuthUser> {
  const ticket = req.headers["x-upload-ticket"];
  if (typeof ticket === "string" && ticket) {
    const claims = await verifyState<{ typ?: string; uid?: string; eid?: string; tv?: number }>(ticket);
    if (claims?.typ !== "upload" || claims.eid !== eventId || !claims.uid) throw unauthorized("This upload link has expired.");
    const user = await one<{ id: string; email: string; name: string; is_admin: boolean; token_version: number }>(
      "SELECT id, email, name, is_admin, token_version FROM users WHERE id = $1",
      [claims.uid],
    );
    if (!user || user.token_version !== claims.tv) throw unauthorized("This upload link has expired.");
    return { id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin };
  }
  const header = req.headers.authorization;
  const user = await userFromToken(header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (!user) throw unauthorized();
  return user;
}

const checkBody = z.object({
  files: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        name: z.string().min(1).max(500),
        size: z.number().int().nonnegative(),
        /** The file's date on the device (ms since epoch or ISO), if known. */
        modifiedAt: z.union([z.number(), z.string()]).nullable().optional(),
      }),
    )
    .min(1)
    .max(10_000),
});

function toDate(v: number | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(typeof v === "number" ? v : /^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function uploadRoutes(app: FastifyInstance) {
  /** A 24-hour pass for background uploads to this event (the Android app uses it). */
  app.post("/api/events/:id/upload-ticket", { preHandler: requireUser }, async (req) => {
    const eventId = parseId(req.params);
    const access = await eventAccess(eventId, req.user.id);
    if (!access.canUpload) throw forbidden("Only the hosts can add photos to this event.");
    const user = await one<{ token_version: number }>("SELECT token_version FROM users WHERE id = $1", [req.user.id]);
    const ticket = await signState({ typ: "upload", uid: req.user.id, eid: eventId, tv: user!.token_version }, UPLOAD_TICKET_TTL);
    return { ticket, expiresInSeconds: 24 * 60 * 60 };
  });

  /**
   * Which of these files are already in the event? "The same file" = same
   * name and size, and the same device date when both sides know it.
   */
  app.post("/api/events/:id/uploads/check", { preHandler: requireUser }, async (req) => {
    const eventId = parseId(req.params);
    await eventAccess(eventId, req.user.id);
    const { files } = parse(checkBody, req.body);
    const rows = await query<{ key: string }>(
      `SELECT f.key
         FROM unnest($2::text[], $3::text[], $4::bigint[], $5::timestamptz[]) AS f(key, name, size, mtime)
        WHERE EXISTS (
          SELECT 1 FROM photos p
           WHERE p.event_id = $1 AND p.status <> 'failed'
             AND lower(p.original_name) = lower(f.name) AND p.size_bytes = f.size
             AND (p.client_modified_at IS NULL OR f.mtime IS NULL
                  OR abs(extract(epoch FROM p.client_modified_at - f.mtime)) < 2))`,
      [
        eventId,
        files.map((f) => f.key),
        files.map((f) => cleanName(f.name)),
        files.map((f) => f.size),
        files.map((f) => toDate(f.modifiedAt)?.toISOString() ?? null),
      ],
    );
    return { duplicates: rows.map((r) => r.key) };
  });

  /** One file per request (so each one gets its own progress), streamed to the spool and queued. */
  app.post("/api/events/:id/photos", async (req, reply) => {
    const eventId = parseId(req.params);
    const user = await uploader(req, eventId);
    const access = await eventAccess(eventId, user.id);
    if (!access.canUpload) throw forbidden("Only the hosts can add photos to this event.");
    // Refused before a single byte is read: there's nowhere to put it yet.
    if (!access.event.storage_folder_id || !access.event.storage_connection_id) throw storagePendingError(access.isOwner);
    const q = parse(
      z.object({ folderId: z.string().uuid().optional(), modifiedAt: z.string().max(40).optional() }),
      req.query,
    );
    if (q.folderId && !(await one("SELECT 1 FROM folders WHERE id = $1 AND event_id = $2", [q.folderId, eventId]))) {
      throw badRequest("That album isn't in this event.");
    }
    // A guest's per-event allowance: the count is known now; the size only once the file is in.
    const limits = access.isHost ? null : guestLimits(access.event);
    const used = limits ? await guestUsage(eventId, user.id) : null;
    if (limits && used) {
      const refused = guestLimitError(limits, used, 0);
      if (refused) throw refused;
    }

    const file = await req.file({ limits: { fileSize: Math.max(config.maxVideoBytes, config.maxUploadBytes), files: 1 } });
    if (!file) throw badRequest("Attach a photo or video.");
    const name = cleanName(file.filename);
    const mediaType = mediaTypeOf(name, file.mimetype);
    if (!mediaType) {
      file.file.resume();
      throw badRequest(`${name} isn't a photo or video.`);
    }

    await ensureSpool();
    const spool = newSpoolPath();
    try {
      await pipeline(file.file, fs.createWriteStream(spool));
    } catch (err) {
      await removeSpool(spool);
      throw err;
    }
    const size = fs.statSync(spool).size;
    const limit = mediaType === "video" ? config.maxVideoBytes : config.maxUploadBytes;
    if (file.file.truncated || size > limit) {
      await removeSpool(spool);
      const mb = mediaType === "video" ? config.MAX_VIDEO_MB : config.MAX_UPLOAD_MB;
      throw new AppError(413, "too_large", `${name} is larger than ${mb} MB.`);
    }
    if (limits && used) {
      const refused = guestLimitError(limits, used, size);
      if (refused) {
        await removeSpool(spool);
        throw refused;
      }
    }

    const row = await one<PhotoRow>(
      `INSERT INTO photos (event_id, folder_id, uploader_id, source, original_name, mime_type, media_type, size_bytes,
                           spool_path, client_modified_at, face_status)
       VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        eventId,
        q.folderId ?? null,
        user.id,
        name,
        mimeFor(name, file.mimetype),
        mediaType,
        size,
        spool,
        toDate(q.modifiedAt),
        mediaType === "video" ? "skipped" : "pending",
      ],
    );
    await enqueueIngest({ photoId: row!.id });
    reply.code(202);
    return { photo: serializePhoto(row!) };
  });
}
