import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { googleSettings } from "../services/settings.js";
import { looksLikeImage } from "../lib/images.js";
import { META_FOLDER, StorageError, type FolderRef, type RemoteImage, type StorageProvider } from "./types.js";

// Full Drive scope: the creator points us at a folder that already exists
// and may already contain photos, which the narrower drive.file scope can't read.
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive"];

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_DEPTH = 6;

export function oauthClient() {
  const g = googleSettings();
  if (!g.enabled) throw new StorageError("Google Drive isn't set up yet. The admin can add it in Admin → Settings.");
  return new google.auth.OAuth2(g.clientId!, g.clientSecret!, g.redirectUri);
}

/** Folder id from any Drive link shape, or the input itself if it already is an id. */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  const patterns = [/\/folders\/([\w-]{10,})/, /[?&]id=([\w-]{10,})/];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1]!;
  }
  return /^[\w-]{10,}$/.test(trimmed) ? trimmed : null;
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function wrap(err: unknown): StorageError {
  const e = err as any;
  const status = e?.code ?? e?.response?.status;
  const reason = e?.response?.data?.error_description ?? e?.response?.data?.error?.message ?? e?.message;
  if (e?.response?.data?.error === "invalid_grant" || status === 401) {
    return new StorageError("Google Drive access was revoked or expired. Reconnect Google Drive.", true);
  }
  if (status === 404) return new StorageError("That Google Drive folder or file doesn't exist, or this account can't see it.");
  if (status === 403) return new StorageError(`Google Drive refused the request: ${reason}`);
  return new StorageError(`Google Drive error: ${reason ?? "unknown"}`);
}

export class GoogleDriveProvider implements StorageProvider {
  readonly name = "gdrive" as const;
  private drive: drive_v3.Drive;

  constructor(refreshToken: string) {
    const auth = oauthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    this.drive = google.drive({ version: "v3", auth });
  }

  /** Display label for the connection, e.g. "you@gmail.com". */
  async accountEmail(): Promise<string> {
    try {
      const { data } = await this.drive.about.get({ fields: "user(emailAddress,displayName)" });
      return data.user?.emailAddress ?? data.user?.displayName ?? "Google Drive";
    } catch (err) {
      throw wrap(err);
    }
  }

  async resolveFolder(input: string): Promise<FolderRef> {
    const id = parseDriveFolderId(input);
    if (!id) throw new StorageError("That doesn't look like a Google Drive folder link.");
    try {
      const { data } = await this.drive.files.get({
        fileId: id,
        fields: "id,name,mimeType,webViewLink,trashed",
        supportsAllDrives: true,
      });
      if (data.mimeType !== FOLDER_MIME) throw new StorageError("That link points to a file, not a folder.");
      if (data.trashed) throw new StorageError("That folder is in the Google Drive trash.");
      return { id: data.id!, name: data.name ?? "Folder", url: data.webViewLink ?? null };
    } catch (err) {
      throw err instanceof StorageError ? err : wrap(err);
    }
  }

  async createFolder(name: string, parentId?: string): Promise<FolderRef> {
    try {
      const { data } = await this.drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      });
      return { id: data.id!, name: data.name ?? name, url: data.webViewLink ?? null };
    } catch (err) {
      throw wrap(err);
    }
  }

  async ensureSubfolder(parentId: string, name: string): Promise<string> {
    try {
      const { data } = await this.drive.files.list({
        q: `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: "files(id)",
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const existing = data.files?.[0]?.id;
      if (existing) return existing;
    } catch (err) {
      throw wrap(err);
    }
    return (await this.createFolder(name, parentId)).id;
  }

  async listImages(folderId: string): Promise<RemoteImage[]> {
    const out: RemoteImage[] = [];
    const queue: { id: string; path: string[]; pathIds: string[] }[] = [{ id: folderId, path: [], pathIds: [] }];
    try {
      while (queue.length) {
        const { id, path, pathIds } = queue.shift()!;
        let pageToken: string | undefined;
        do {
          const { data } = await this.drive.files.list({
            q: `${quote(id)} in parents and trashed = false`,
            fields: "nextPageToken, files(id,name,mimeType,size,imageMediaMetadata(time))",
            pageSize: 1000,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });
          for (const f of data.files ?? []) {
            if (f.mimeType === FOLDER_MIME) {
              if (f.name === META_FOLDER) continue;
              if (path.length < MAX_DEPTH) {
                queue.push({ id: f.id!, path: [...path, f.name ?? "Folder"], pathIds: [...pathIds, f.id!] });
              }
            } else if (looksLikeImage(f.name ?? "", f.mimeType)) {
              out.push({
                id: f.id!,
                name: f.name ?? "photo",
                mimeType: f.mimeType ?? null,
                size: f.size ? Number(f.size) : null,
                parentId: id,
                path,
                pathIds,
                takenAt: parseExifTime(f.imageMediaMetadata?.time),
              });
            }
          }
          pageToken = data.nextPageToken ?? undefined;
        } while (pageToken);
      }
    } catch (err) {
      throw wrap(err);
    }
    return out;
  }

  async upload(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
    try {
      const res = await this.drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType, body: Readable.from(data) },
        fields: "id",
        supportsAllDrives: true,
      });
      return res.data.id!;
    } catch (err) {
      throw wrap(err);
    }
  }

  async putFile(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
    try {
      const { data: found } = await this.drive.files.list({
        q: `${quote(folderId)} in parents and name = ${quote(name)} and trashed = false`,
        fields: "files(id)",
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const existing = found.files?.[0]?.id;
      if (existing) {
        await this.drive.files.update({
          fileId: existing,
          media: { mimeType, body: Readable.from(data) },
          supportsAllDrives: true,
        });
        return existing;
      }
    } catch (err) {
      throw wrap(err);
    }
    return this.upload(folderId, name, mimeType, data);
  }

  async download(fileId: string): Promise<Buffer> {
    try {
      const res = await this.drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (err) {
      throw wrap(err);
    }
  }

  async openStream(fileId: string) {
    try {
      const res = await this.drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" },
      );
      const len = res.headers["content-length"];
      return {
        stream: res.data as unknown as Readable,
        size: len ? Number(len) : null,
        mimeType: (res.headers["content-type"] as string | undefined) ?? null,
      };
    } catch (err) {
      throw wrap(err);
    }
  }

  async trash(fileId: string): Promise<void> {
    try {
      await this.drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    } catch (err) {
      const e = wrap(err);
      // Already gone is fine — that's what we wanted.
      if (!/doesn't exist/.test(e.message)) throw e;
    }
  }
}

/** Drive reports EXIF time as "2024:05:01 13:22:10". */
function parseExifTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  const date = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
