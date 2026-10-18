import { Storage, type MutableFile } from "megajs";
import { looksLikeImage } from "../lib/images.js";
import { META_FOLDER, StorageError, type FolderRef, type RemoteImage, type StorageProvider } from "./types.js";

export interface MegaCredentials {
  email: string;
  password: string;
}

// Logging in to MEGA derives keys from the password and downloads the whole
// file tree, so keep one session per connection alive for a while.
const SESSION_TTL_MS = 20 * 60 * 1000;
const sessions = new Map<string, { storage: Promise<Storage>; at: number }>();

function login({ email, password }: MegaCredentials): Promise<Storage> {
  return new Storage({ email, password, keepalive: false, userAgent: "InFrame/0.1" }).ready.catch((err: Error) => {
    // MEGA API codes: -26 EMFAREQUIRED (2FA on), -9 ENOENT (wrong email/password).
    const msg = /EMFAREQUIRED|-26\b|second factor/i.test(err.message)
      ? "This MEGA account uses two-factor login, which InFrame can't keep signed in."
      : /ENOENT|EKEY|-9\b|incorrect/i.test(err.message)
        ? "MEGA rejected that email or password."
        : `Couldn't sign in to MEGA: ${err.message}`;
    throw new StorageError(msg, true);
  });
}

/** Signs in once to check credentials; returns nothing on success. */
export async function verifyMegaLogin(creds: MegaCredentials) {
  const storage = await login(creds);
  await storage.close().catch(() => {});
}

export function forgetMegaSession(connectionId: string) {
  const entry = sessions.get(connectionId);
  sessions.delete(connectionId);
  entry?.storage.then((s) => s.close()).catch(() => {});
}

/** Parses https://mega.nz/folder/<handle>#<key> (and the legacy #F!handle!key form). */
export function parseMegaHandle(input: string): string | null {
  const s = input.trim();
  const m = s.match(/mega\.(?:nz|co\.nz|io)\/(?:folder|file)\/([\w-]{8})/) ?? s.match(/#F?!([\w-]{8})!/);
  if (m) return m[1]!;
  return /^[\w-]{8}$/.test(s) ? s : null;
}

const call = <T>(fn: (cb: (err: Error | null, value?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value as T))));

export class MegaProvider implements StorageProvider {
  readonly name = "mega" as const;

  constructor(
    private connectionId: string,
    private creds: MegaCredentials,
  ) {}

  private async storage(fresh = false): Promise<Storage> {
    const now = Date.now();
    const entry = sessions.get(this.connectionId);
    if (entry && now - entry.at < SESSION_TTL_MS) {
      const storage = await entry.storage.catch(() => null);
      if (storage) {
        if (fresh) await storage.reload(true).catch(() => {});
        return storage;
      }
    }
    if (entry) forgetMegaSession(this.connectionId);
    const storage = login(this.creds);
    sessions.set(this.connectionId, { storage, at: now });
    storage.catch(() => sessions.delete(this.connectionId));
    return storage;
  }

  private async node(id: string, fresh = false): Promise<MutableFile> {
    const storage = await this.storage(fresh);
    const node = storage.files[id] ?? (fresh ? undefined : (await this.storage(true)).files[id]);
    if (!node) throw new StorageError("That MEGA file or folder isn't in the connected account (or was deleted).");
    return node;
  }

  private async folderRef(node: MutableFile): Promise<FolderRef> {
    return { id: node.nodeId!, name: node.name ?? "Folder", url: null };
  }

  async resolveFolder(input: string): Promise<FolderRef> {
    const storage = await this.storage(true);
    const handle = parseMegaHandle(input);
    let node: MutableFile | undefined;
    if (handle) node = storage.files[handle];
    // Also accept a plain path inside the account, like "Trips/Goa 2026".
    else if (input.trim()) node = storage.root.navigate(input.trim().replace(/^\/+|\/+$/g, "").split("/"));
    if (!node) {
      throw new StorageError(
        handle
          ? "That MEGA folder isn't in the connected account. Use a folder that belongs to it."
          : "Couldn't find that folder in MEGA. Paste the folder's link, or its path like Trips/Goa.",
      );
    }
    if (!node.directory) throw new StorageError("That MEGA link points to a file, not a folder.");
    return this.folderRef(node);
  }

  async createFolder(name: string, parentId?: string): Promise<FolderRef> {
    const storage = await this.storage();
    const parent = parentId ? await this.node(parentId) : storage.root;
    return this.folderRef(await parent.mkdir(name));
  }

  async ensureSubfolder(parentId: string, name: string): Promise<string> {
    const parent = await this.node(parentId);
    const existing = parent.children?.find((c) => c.directory && c.name === name);
    return existing?.nodeId ?? (await parent.mkdir(name)).nodeId!;
  }

  async listImages(folderId: string): Promise<RemoteImage[]> {
    const root = await this.node(folderId, true);
    const out: RemoteImage[] = [];
    const walk = (dir: MutableFile, path: string[], pathIds: string[]) => {
      for (const child of dir.children ?? []) {
        if (child.directory) {
          if (child.name === META_FOLDER) continue;
          if (path.length < 6) walk(child, [...path, child.name ?? "Folder"], [...pathIds, child.nodeId ?? ""]);
        } else if (child.nodeId && looksLikeImage(child.name ?? "")) {
          out.push({
            id: child.nodeId,
            name: child.name ?? "photo",
            mimeType: null,
            size: child.size ?? null,
            parentId: dir.nodeId!,
            path,
            pathIds,
            takenAt: null,
          });
        }
      }
    };
    walk(root, [], []);
    return out;
  }

  async upload(folderId: string, name: string, _mimeType: string, data: Buffer): Promise<string> {
    const folder = await this.node(folderId);
    const file = await call<MutableFile>((cb) => folder.upload({ name, size: data.length }, data, cb));
    return file.nodeId!;
  }

  async putFile(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
    // MEGA has no in-place content update: drop any same-named file, then upload.
    const folder = await this.node(folderId);
    for (const child of folder.children ?? []) {
      if (!child.directory && child.name === name) await child.delete(true).catch(() => {});
    }
    return this.upload(folderId, name, mimeType, data);
  }

  async download(fileId: string): Promise<Buffer> {
    const file = await this.node(fileId);
    try {
      return await file.downloadBuffer({});
    } catch (err) {
      throw new StorageError(`MEGA download failed: ${(err as Error).message}`);
    }
  }

  async openStream(fileId: string) {
    const file = await this.node(fileId);
    return { stream: file.download({}), size: file.size ?? null, mimeType: null };
  }

  async trash(fileId: string): Promise<void> {
    const storage = await this.storage();
    const file = storage.files[fileId];
    if (file) await file.delete(false); // false = rubbish bin, not permanent
  }
}
