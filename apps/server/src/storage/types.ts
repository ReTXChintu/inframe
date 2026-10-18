import type { Readable } from "node:stream";

export type ProviderName = "gdrive" | "mega" | "memory";

/** Hidden sub-folder, inside any photo folder, that holds InFrame's thumbnails and previews. */
export const META_FOLDER = ".inframe";

export interface FolderRef {
  id: string;
  name: string;
  url: string | null;
}

export interface RemoteImage {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  /** Folder that directly contains the file. */
  parentId: string;
  /** Sub-folder names from the event's root folder down to the file ([] = in the root). */
  path: string[];
  /** Provider ids of those same sub-folders. */
  pathIds: string[];
  takenAt: Date | null;
}

export interface RemoteStream {
  stream: Readable;
  size: number | null;
  mimeType: string | null;
}

/** One connected account, scoped to whatever folders it can reach. */
export interface StorageProvider {
  readonly name: ProviderName;
  /** Accepts a share link, a folder URL, or a raw folder id/handle. */
  resolveFolder(input: string): Promise<FolderRef>;
  createFolder(name: string, parentId?: string): Promise<FolderRef>;
  /** Finds or creates `name` directly inside `parentId`; returns its id. */
  ensureSubfolder(parentId: string, name: string): Promise<string>;
  /** Every image under the folder, recursively — skipping ".inframe" folders. */
  listImages(folderId: string): Promise<RemoteImage[]>;
  /** Adds a new file (names may repeat). */
  upload(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string>;
  /** Creates or replaces the file called `name` in the folder (safe to repeat). */
  putFile(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string>;
  download(fileId: string): Promise<Buffer>;
  openStream(fileId: string): Promise<RemoteStream>;
  /** Moves to the provider's trash/rubbish bin, so it stays recoverable. Missing files are ignored. */
  trash(fileId: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    /** The account itself is broken (revoked token, bad password) — not just this call. */
    public connectionBroken = false,
  ) {
    super(message);
  }
}
