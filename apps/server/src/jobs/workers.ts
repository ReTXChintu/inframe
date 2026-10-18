import type PgBoss from "pg-boss";
import { config } from "../config.js";
import { one, query, tx } from "../db/pool.js";
import { decodable, forModel, makeDerivatives } from "../lib/images.js";
import { cacheDelete, cacheGet, cacheSet, mediaKey, takeOriginal } from "../lib/media-cache.js";
import { toVector } from "../lib/vector.js";
import { extractFaces, ModelError } from "../model/client.js";
import { toEvent, toUser } from "../realtime/io.js";
import { matchPhoto } from "../services/matching.js";
import {
  derivativeName,
  eventStorage,
  forgetMetaFolder,
  markConnection,
  metaFolderFor,
  StorageError,
} from "../storage/index.js";
import type { StorageProvider } from "../storage/types.js";
import {
  boss,
  enqueueFaces,
  enqueueIngestMany,
  enqueueSync,
  isLastAttempt,
  Q,
  type FacesJob,
  type IngestJob,
  type SyncJob,
} from "./queue.js";

interface PhotoJobRow {
  id: string;
  event_id: string;
  folder_id: string | null;
  source: "upload" | "storage";
  original_name: string;
  mime_type: string | null;
  storage_file_id: string | null;
  storage_parent_id: string | null;
  thumb_file_id: string | null;
  preview_file_id: string | null;
  status: string;
}

const loadPhoto = (id: string) => one<PhotoJobRow>("SELECT * FROM photos WHERE id = $1", [id]);

function emitStatus(eventId: string, photoId: string, patch: Record<string, unknown>) {
  // Ids and states only: clients fetch the photo through the API, which checks
  // what each member is allowed to see.
  toEvent(eventId, "photo:status", { eventId, photoId, ...patch });
}

const short = (err: unknown) => ((err as Error)?.message ?? String(err)).slice(0, 500);

/** Write a derivative into `<parent>/.inframe/`, re-creating that folder if someone deleted it. */
async function putDerivative(provider: StorageProvider, parentId: string, name: string, data: Buffer) {
  try {
    return await provider.putFile(await metaFolderFor(provider, parentId), name, "image/webp", data);
  } catch (err) {
    if (err instanceof StorageError && err.connectionBroken) throw err;
    forgetMetaFolder(provider, parentId);
    return provider.putFile(await metaFolderFor(provider, parentId), name, "image/webp", data);
  }
}

// ─── photo-ingest: thumbnail + preview into the photo's ".inframe" folder ──
async function ingest(job: PgBoss.JobWithMetadata<IngestJob>) {
  const { photoId } = job.data;
  const photo = await loadPhoto(photoId);
  if (!photo) return; // deleted while queued

  await query("UPDATE photos SET status = 'processing', error = NULL, updated_at = now() WHERE id = $1", [photoId]);
  emitStatus(photo.event_id, photoId, { status: "processing", stage: "processing" });

  let connId: string | undefined;
  try {
    const { provider, folderId, conn } = await eventStorage(photo.event_id);
    connId = conn.id;
    if (!photo.storage_file_id) throw new StorageError("The original file is missing from storage.");

    const original = takeOriginal(photoId) ?? (await provider.download(photo.storage_file_id));
    const d = await makeDerivatives(await decodable(original, photo.original_name, photo.mime_type));

    const parent = photo.storage_parent_id ?? folderId;
    const thumbId = await putDerivative(provider, parent, derivativeName(photo.original_name, photo.storage_file_id, "thumb"), d.thumb);
    const previewId = await putDerivative(provider, parent, derivativeName(photo.original_name, photo.storage_file_id, "preview"), d.preview);
    cacheSet(mediaKey(photoId, "thumb"), d.thumb);
    cacheSet(mediaKey(photoId, "preview"), d.preview);

    await query(
      `UPDATE photos SET status = 'ready', width = $2, height = $3,
              taken_at = COALESCE($4, taken_at), sort_at = COALESCE($4, taken_at, sort_at),
              size_bytes = COALESCE(size_bytes, $5), storage_parent_id = $6,
              thumb_file_id = $7, preview_file_id = $8, updated_at = now()
        WHERE id = $1`,
      [photoId, d.width, d.height, d.takenAt, original.length, parent, thumbId, previewId],
    );
    emitStatus(photo.event_id, photoId, { status: "ready", stage: "finding-faces" });
    await enqueueFaces({ photoId });
  } catch (err) {
    if (connId) await markConnection(connId, err);
    const final = isLastAttempt(job) || (err instanceof StorageError && err.connectionBroken);
    if (!final) {
      emitStatus(photo.event_id, photoId, { status: "processing", stage: "retrying", error: short(err) });
      throw err;
    }
    await query("UPDATE photos SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [photoId, short(err)]);
    emitStatus(photo.event_id, photoId, { status: "failed", error: short(err) });
  }
}

/** Preview bytes for a photo: memory cache, else its file in storage. */
export async function previewBytes(photo: Pick<PhotoJobRow, "id" | "event_id" | "preview_file_id">, provider?: StorageProvider) {
  const cached = cacheGet(mediaKey(photo.id, "preview"));
  if (cached) return cached;
  if (!photo.preview_file_id) throw new StorageError("This photo has no preview yet.");
  const p = provider ?? (await eventStorage(photo.event_id)).provider;
  const bytes = await p.download(photo.preview_file_id);
  cacheSet(mediaKey(photo.id, "preview"), bytes);
  return bytes;
}

// ─── photo-faces ──────────────────────────────────────────────────────────
async function detectFaces(job: PgBoss.JobWithMetadata<FacesJob>) {
  const { photoId } = job.data;
  const photo = await loadPhoto(photoId);
  if (!photo || photo.status !== "ready") return;

  await query("UPDATE photos SET face_status = 'processing', updated_at = now() WHERE id = $1", [photoId]);
  emitStatus(photo.event_id, photoId, { faceStatus: "processing" });

  try {
    const faces = await extractFaces(await forModel(await previewBytes(photo)));

    const hits = await tx(async (db) => {
      await db.query("DELETE FROM faces WHERE photo_id = $1", [photoId]);
      for (const face of faces) {
        await db.query("INSERT INTO faces (photo_id, event_id, embedding, det_score) VALUES ($1, $2, $3, $4)", [
          photoId,
          photo.event_id,
          toVector(face.embedding),
          face.score,
        ]);
      }
      await db.query(
        "UPDATE photos SET face_status = 'done', face_count = $2, error = NULL, updated_at = now() WHERE id = $1",
        [photoId, faces.length],
      );
      return matchPhoto(photoId, db);
    });

    emitStatus(photo.event_id, photoId, { faceStatus: "done", faceCount: faces.length, matchCount: hits.length });

    const byOwner = new Map<string, { id: string; name: string; kind: string }[]>();
    for (const h of hits) {
      const list = byOwner.get(h.owner_id) ?? [];
      list.push({ id: h.person_id, name: h.person_name, kind: h.kind });
      byOwner.set(h.owner_id, list);
    }
    for (const [ownerId, people] of byOwner) {
      toUser(ownerId, "photo:matched", { eventId: photo.event_id, photoId, people });
    }
  } catch (err) {
    const retryable = !(err instanceof ModelError) || err.retryable;
    if (retryable && !isLastAttempt(job)) throw err;
    // A failed detection is recorded as failed, never as "no faces", so hosts can re-run it.
    await query("UPDATE photos SET face_status = 'failed', error = $2, updated_at = now() WHERE id = $1", [
      photoId,
      short(err),
    ]);
    emitStatus(photo.event_id, photoId, { faceStatus: "failed", error: short(err) });
  }
}

/** Trash a photo's thumbnail/preview files and forget their cached bytes. Best effort. */
export async function trashDerivatives(
  provider: StorageProvider | null,
  photo: { id: string; thumb_file_id: string | null; preview_file_id: string | null },
) {
  cacheDelete(mediaKey(photo.id, "thumb"));
  cacheDelete(mediaKey(photo.id, "preview"));
  if (!provider) return;
  for (const id of [photo.thumb_file_id, photo.preview_file_id]) {
    if (id) await provider.trash(id).catch(() => {});
  }
}

// ─── event-sync ───────────────────────────────────────────────────────────
async function syncEvent(job: PgBoss.JobWithMetadata<SyncJob>) {
  const { eventId } = job.data;
  const exists = await one("SELECT 1 FROM events WHERE id = $1", [eventId]);
  if (!exists) return;

  const startedAt = new Date();
  await query("UPDATE events SET sync_state = 'syncing', sync_error = NULL WHERE id = $1", [eventId]);
  toEvent(eventId, "event:sync", { eventId, state: "syncing" });

  let connId: string | undefined;
  try {
    const { provider, folderId, conn } = await eventStorage(eventId);
    connId = conn.id;
    const remote = await provider.listImages(folderId);

    const known = await query<{
      id: string;
      storage_file_id: string;
      thumb_file_id: string | null;
      preview_file_id: string | null;
      updated_at: Date;
    }>(
      `SELECT id, storage_file_id, thumb_file_id, preview_file_id, updated_at
         FROM photos WHERE event_id = $1 AND storage_file_id IS NOT NULL`,
      [eventId],
    );
    const knownIds = new Set(known.map((k) => k.storage_file_id));
    const remoteIds = new Set(remote.map((r) => r.id));

    // Albums: a file's first sub-folder under the event folder, matched by the
    // sub-folder's storage id first (survives renames), then by name.
    const folders = await query<{ id: string; name: string; storage_folder_id: string | null }>(
      "SELECT id, name, storage_folder_id FROM folders WHERE event_id = $1",
      [eventId],
    );
    const folderByRemote = new Map(folders.filter((f) => f.storage_folder_id).map((f) => [f.storage_folder_id!, f.id]));
    const folderByName = new Map(folders.map((f) => [f.name.toLowerCase(), f.id]));
    const folderFor = async (path: string[], pathIds: string[]) => {
      const name = path[0]?.trim();
      const remoteId = pathIds[0];
      if (!name || !remoteId) return null;
      const hit = folderByRemote.get(remoteId) ?? folderByName.get(name.toLowerCase());
      if (hit) return hit;
      const row = await one<{ id: string }>(
        `INSERT INTO folders (event_id, name, storage_folder_id) VALUES ($1, $2, $3)
         ON CONFLICT (event_id, lower(name)) DO UPDATE SET storage_folder_id = COALESCE(folders.storage_folder_id, EXCLUDED.storage_folder_id)
         RETURNING id`,
        [eventId, name.slice(0, 80), remoteId],
      );
      folderByRemote.set(remoteId, row!.id);
      folderByName.set(name.toLowerCase(), row!.id);
      return row!.id;
    };

    const fresh: IngestJob[] = [];
    for (const file of remote) {
      if (knownIds.has(file.id)) continue;
      const row = await one<{ id: string }>(
        `INSERT INTO photos (event_id, folder_id, source, original_name, mime_type, size_bytes, taken_at, sort_at,
                             storage_file_id, storage_parent_id)
         VALUES ($1, $2, 'storage', $3, $4, $5, $6, COALESCE($6, now()), $7, $8)
         ON CONFLICT (event_id, storage_file_id) WHERE storage_file_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [eventId, await folderFor(file.path, file.pathIds), file.name, file.mimeType, file.size, file.takenAt, file.id, file.parentId],
      );
      if (row) fresh.push({ photoId: row.id });
    }
    await enqueueIngestMany(fresh);

    // Originals deleted from the folder disappear from InFrame too (and their
    // derivatives are trashed) — except ones touched since this scan started.
    const gone = known.filter((k) => !remoteIds.has(k.storage_file_id) && k.updated_at < startedAt);
    if (gone.length) {
      await query("DELETE FROM photos WHERE id = ANY($1::uuid[])", [gone.map((g) => g.id)]);
      for (const g of gone) await trashDerivatives(provider, g);
    }

    await query(
      "UPDATE events SET sync_state = 'idle', sync_error = NULL, last_synced_at = now() WHERE id = $1",
      [eventId],
    );
    await query("UPDATE storage_connections SET status = 'ok', last_error = NULL WHERE id = $1 AND status = 'error'", [
      conn.id,
    ]);
    toEvent(eventId, "event:sync", { eventId, state: "idle", added: fresh.length, removed: gone.length });
  } catch (err) {
    if (connId) await markConnection(connId, err);
    if (!isLastAttempt(job) && !(err instanceof StorageError)) throw err;
    await query("UPDATE events SET sync_state = 'error', sync_error = $2 WHERE id = $1", [eventId, short(err)]);
    toEvent(eventId, "event:sync", { eventId, state: "error", error: short(err) });
  }
}

async function syncAll() {
  const events = await query<{ id: string }>(
    `SELECT e.id FROM events e JOIN storage_connections c ON c.id = e.storage_connection_id
      WHERE e.storage_folder_id IS NOT NULL AND c.status = 'ok'`,
  );
  for (const e of events) await enqueueSync(e.id);
}

/** Start polling. Each `work()` call is one independent worker loop. */
export async function startWorkers() {
  const opts = { includeMetadata: true as const, batchSize: 1, pollingIntervalSeconds: 1 };
  for (let i = 0; i < config.WORKER_CONCURRENCY; i++) {
    await boss.work<IngestJob>(Q.ingest, opts, async ([job]) => ingest(job!));
    await boss.work<FacesJob>(Q.faces, opts, async ([job]) => detectFaces(job!));
  }
  await boss.work<SyncJob>(Q.sync, { ...opts, pollingIntervalSeconds: 2 }, async ([job]) => syncEvent(job!));
  await boss.work(Q.syncAll, { pollingIntervalSeconds: 30 }, async () => syncAll());
  await boss.schedule(Q.syncAll, config.SYNC_CRON);
}
