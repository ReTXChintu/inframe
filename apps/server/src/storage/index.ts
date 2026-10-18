import crypto from "node:crypto";
import { config } from "../config.js";
import { one, query } from "../db/pool.js";
import { decryptJson } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";
import { GoogleDriveProvider } from "./gdrive.js";
import { MegaProvider, type MegaCredentials } from "./mega.js";
import { MemoryProvider } from "./memory.js";
import { META_FOLDER, StorageError, type ProviderName, type StorageProvider } from "./types.js";

export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: ProviderName;
  account_label: string;
  secret: string;
  status: "ok" | "error";
  last_error: string | null;
}

export function providerFor(conn: ConnectionRow): StorageProvider {
  if (conn.provider === "gdrive") {
    const { refreshToken } = decryptJson<{ refreshToken: string }>(conn.secret);
    return new GoogleDriveProvider(refreshToken);
  }
  if (conn.provider === "memory") {
    if (!config.devMemoryStorage) throw new StorageError("Development memory storage is disabled on this server.", true);
    return new MemoryProvider();
  }
  return new MegaProvider(conn.id, decryptJson<MegaCredentials>(conn.secret));
}

export async function loadConnection(id: string): Promise<ConnectionRow> {
  const conn = await one<ConnectionRow>("SELECT * FROM storage_connections WHERE id = $1", [id]);
  if (!conn) throw notFound("Storage connection");
  return conn;
}

/** The provider an event stores its photos in, plus the root folder id. */
export async function eventStorage(eventId: string): Promise<{ provider: StorageProvider; folderId: string; conn: ConnectionRow }> {
  const row = await one<ConnectionRow & { storage_folder_id: string | null }>(
    `SELECT c.*, e.storage_folder_id
       FROM events e JOIN storage_connections c ON c.id = e.storage_connection_id
      WHERE e.id = $1`,
    [eventId],
  );
  if (!row || !row.storage_folder_id) {
    throw new StorageError("This event has no storage folder connected. The owner can set one in event settings.");
  }
  return { provider: providerFor(row), folderId: row.storage_folder_id, conn: row };
}

/** Record that a connection stopped working so the UI can prompt a reconnect. */
export async function markConnection(connId: string, err: unknown) {
  if (err instanceof StorageError && err.connectionBroken) {
    await query("UPDATE storage_connections SET status = 'error', last_error = $2, updated_at = now() WHERE id = $1", [
      connId,
      err.message,
    ]);
  }
}

// ─── Derivatives: <folder>/.inframe/<name>.<hash>.{thumb,preview}.webp ────
const metaFolders = new Map<string, string>();

/** Id of the hidden ".inframe" folder inside `parentId` (created on first use, then remembered). */
export async function metaFolderFor(provider: StorageProvider, parentId: string): Promise<string> {
  const key = `${provider.name}:${parentId}`;
  const cached = metaFolders.get(key);
  if (cached) return cached;
  const id = await provider.ensureSubfolder(parentId, META_FOLDER);
  metaFolders.set(key, id);
  return id;
}

export function forgetMetaFolder(provider: StorageProvider, parentId: string) {
  metaFolders.delete(`${provider.name}:${parentId}`);
}

/**
 * "IMG_2041.jpg" → "IMG_2041.3fa9c1.thumb.webp". The short hash of the
 * original's storage id keeps two same-named photos from sharing derivatives,
 * and stays stable so re-processing overwrites instead of piling up copies.
 */
export function derivativeName(originalName: string, originalFileId: string, variant: "thumb" | "preview") {
  const base = originalName.replace(/\.[^.]+$/, "") || "photo";
  const hash = crypto.createHash("sha1").update(originalFileId).digest("hex").slice(0, 6);
  return `${base}.${hash}.${variant}.webp`;
}

export { StorageError };
