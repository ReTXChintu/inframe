import type { FastifyInstance, FastifyReply } from "fastify";
import archiver from "archiver";
import { z } from "zod";
import { one, query } from "../db/pool.js";
import { randomToken } from "../lib/crypto.js";
import { notFound, parse } from "../lib/errors.js";
import { mimeFor } from "../lib/images.js";
import { cacheGet, cacheSet, mediaKey } from "../lib/media-cache.js";
import { verifyMedia } from "../lib/media-urls.js";
import { enqueueIngest } from "../jobs/queue.js";
import { eventStorage, StorageError } from "../storage/index.js";
import type { ByteRange } from "../storage/types.js";

/*
 * Image bytes are served from signed, expiring URLs (minted by the API for
 * people allowed to see the photo), so <img src> works without auth headers.
 */

const ZIP_TTL_MS = 10 * 60 * 1000;
const zipTickets = new Map<string, { userId: string; photoIds: string[]; expires: number }>();

export function createZipTicket(userId: string, photoIds: string[]) {
  const now = Date.now();
  for (const [k, t] of zipTickets) if (t.expires < now) zipTickets.delete(k);
  const id = randomToken(24);
  zipTickets.set(id, { userId, photoIds, expires: now + ZIP_TTL_MS });
  return `/media/zip/${id}`;
}

/**
 * Parse `Range: bytes=…` against a file of `size` bytes (single ranges only —
 * what video players send). null = serve the whole file; "invalid" = 416.
 */
function parseRange(header: string | undefined, size: number | null): ByteRange | null | "invalid" {
  if (!header || !size) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "invalid";
  // megajs treats end=0 as "to the end of the file"; ask for one more byte instead.
  if (end === 0) end = Math.min(1, size - 1);
  return { start, end };
}

const disposition = (kind: "inline" | "attachment", name: string) =>
  `${kind}; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

function sendWebp(reply: FastifyReply, bytes: Buffer) {
  return reply
    .header("Content-Type", "image/webp")
    .header("Cache-Control", "private, max-age=21600")
    .send(bytes);
}

interface MediaPhoto {
  id: string;
  event_id: string;
  original_name: string;
  mime_type: string | null;
  media_type: "image" | "video";
  size_bytes: number | null;
  storage_file_id: string | null;
  thumb_file_id: string | null;
  preview_file_id: string | null;
  status: string;
}

// Photos whose derivative went missing from storage (e.g. someone emptied the
// ".inframe" folder) get rebuilt — once per process per photo, not per request.
const rebuilding = new Set<string>();
async function rebuild(photoId: string) {
  if (rebuilding.has(photoId)) return;
  rebuilding.add(photoId);
  await enqueueIngest({ photoId }).catch(() => rebuilding.delete(photoId));
}

export async function mediaRoutes(app: FastifyInstance) {
  app.get("/media/p/:id/:variant", async (req, reply) => {
    const { id, variant } = parse(
      z.object({ id: z.string().uuid(), variant: z.enum(["thumb", "preview", "original"]) }),
      req.params,
    );
    const q = req.query as Record<string, string | undefined>;
    if (!verifyMedia(`p:${id}:${variant}`, q.e, q.s)) return reply.code(403).send({ message: "This link has expired." });

    const photo = await one<MediaPhoto>("SELECT * FROM photos WHERE id = $1", [id]);
    if (!photo || photo.status !== "ready") throw notFound("Photo");

    if (variant === "original") {
      const { provider } = await eventStorage(photo.event_id);
      const total = photo.size_bytes;
      // Videos need byte ranges for seeking (and iOS/Android players insist on them).
      const range = parseRange(req.headers.range, total);
      if (range === "invalid") {
        return reply.code(416).header("Content-Range", `bytes */${total}`).send();
      }
      const remote = await provider.openStream(photo.storage_file_id ?? "", range ?? undefined);
      reply
        .header("Content-Type", mimeFor(photo.original_name, photo.mime_type ?? remote.mimeType))
        .header("Content-Disposition", disposition(q.dl ? "attachment" : "inline", photo.original_name))
        .header("Cache-Control", "private, max-age=3600");
      if (total) reply.header("Accept-Ranges", "bytes");
      if (range && total) {
        reply
          .code(206)
          .header("Content-Range", `bytes ${range.start}-${range.end}/${total}`)
          .header("Content-Length", range.end - range.start + 1);
      } else if (remote.size ?? total) {
        reply.header("Content-Length", remote.size ?? total);
      }
      return reply.send(remote.stream);
    }

    // Thumbnail / preview: memory cache, else the file in the photo's ".inframe" folder.
    const key = mediaKey(id, variant);
    const cached = cacheGet(key);
    if (cached) return sendWebp(reply, cached);
    const fileId = variant === "thumb" ? photo.thumb_file_id : photo.preview_file_id;
    if (!fileId) {
      // A video whose poster couldn't be made has no previews by design — don't keep retrying it.
      if (photo.media_type !== "video") await rebuild(id);
      throw notFound("Preview");
    }
    try {
      const { provider } = await eventStorage(photo.event_id);
      const bytes = await provider.download(fileId);
      cacheSet(key, bytes);
      return sendWebp(reply, bytes);
    } catch (err) {
      if (err instanceof StorageError && !err.connectionBroken) await rebuild(id);
      throw err;
    }
  });

  app.get("/media/s/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const q = req.query as Record<string, string | undefined>;
    if (!verifyMedia(`s:${id}`, q.e, q.s)) return reply.code(403).send({ message: "This link has expired." });
    const row = await one<{ selfie_image: Buffer | null }>("SELECT selfie_image FROM people WHERE id = $1", [id]);
    if (!row?.selfie_image) throw notFound("Selfie");
    return sendWebp(reply, row.selfie_image);
  });

  app.get("/media/zip/:ticket", async (req, reply) => {
    const { ticket } = req.params as { ticket: string };
    const entry = zipTickets.get(ticket);
    if (!entry || entry.expires < Date.now()) return reply.code(410).send({ message: "This download link has expired." });
    zipTickets.delete(ticket); // one use

    const photos = await query<MediaPhoto & { event_name: string }>(
      `SELECT p.*, e.name AS event_name FROM photos p JOIN events e ON e.id = p.event_id
        WHERE p.id = ANY($1::uuid[]) AND p.status = 'ready' ORDER BY p.sort_at`,
      [entry.photoIds],
    );
    const single = new Set(photos.map((p) => p.event_id)).size === 1;
    const zipName = `${single ? photos[0]?.event_name ?? "InFrame" : "InFrame"} photos.zip`;

    // Already-compressed images: "store" keeps it fast and the ZIP the same size.
    const archive = archiver("zip", { store: true });
    reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", disposition("attachment", zipName))
      .header("Cache-Control", "no-store");

    const used = new Set<string>();
    const uniqueName = (name: string, folder: string) => {
      let candidate = `${folder}${name}`;
      for (let i = 2; used.has(candidate.toLowerCase()); i++) {
        candidate = `${folder}${name.replace(/(\.[^.]*)?$/, ` (${i})$1`)}`;
      }
      used.add(candidate.toLowerCase());
      return candidate;
    };

    // Append sequentially in the background so each storage stream opens only when needed.
    (async () => {
      const storages = new Map<string, Awaited<ReturnType<typeof eventStorage>> | null>();
      for (const p of photos) {
        try {
          if (!storages.has(p.event_id)) storages.set(p.event_id, await eventStorage(p.event_id).catch(() => null));
          const storage = storages.get(p.event_id);
          if (!storage || !p.storage_file_id) continue;
          const { stream } = await storage.provider.openStream(p.storage_file_id);
          const folder = single ? "" : `${p.event_name.replace(/[\\/:*?"<>|]/g, "_")}/`;
          archive.append(stream, { name: uniqueName(p.original_name, folder) });
          await new Promise<void>((resolve) => {
            stream.once("end", resolve);
            stream.once("error", () => resolve());
          });
        } catch (err) {
          req.log.warn({ err, photoId: p.id }, "zip: skipping photo");
        }
      }
      await archive.finalize();
    })().catch((err) => archive.abort());

    return reply.send(archive);
  });
}
