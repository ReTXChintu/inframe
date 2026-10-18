import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { looksLikeImage } from "../lib/images.js";
import { META_FOLDER, StorageError, type FolderRef, type RemoteImage, type StorageProvider } from "./types.js";

/*
 * DEVELOPMENT ONLY. A fake storage account held in this process's memory, so
 * the whole upload → thumbnails → faces pipeline can be exercised without
 * Google/MEGA credentials. Enabled by DEV_MEMORY_STORAGE=true, refused in
 * production, and everything in it disappears when the server restarts.
 */

interface Node {
  id: string;
  name: string;
  parent: string | null;
  dir: boolean;
  mime?: string;
  data?: Buffer;
  trashed?: boolean;
}

const nodes = new Map<string, Node>();
const ROOT = "mem-root";
nodes.set(ROOT, { id: ROOT, name: "Memory storage", parent: null, dir: true });

const children = (id: string) => [...nodes.values()].filter((n) => n.parent === id && !n.trashed);

export class MemoryProvider implements StorageProvider {
  readonly name = "memory" as const;

  private get(id: string): Node {
    const n = nodes.get(id);
    if (!n || n.trashed) throw new StorageError("That file or folder doesn't exist (memory storage resets on restart).");
    return n;
  }

  async resolveFolder(input: string): Promise<FolderRef> {
    const id = input.trim().replace(/^memory:\/\//, "");
    const n = id === "" || id === "/" ? this.get(ROOT) : this.get(id);
    if (!n.dir) throw new StorageError("That's a file, not a folder.");
    return { id: n.id, name: n.name, url: null };
  }

  async createFolder(name: string, parentId = ROOT): Promise<FolderRef> {
    const id = `mem-${randomUUID()}`;
    nodes.set(id, { id, name, parent: this.get(parentId).id, dir: true });
    return { id, name, url: null };
  }

  async ensureSubfolder(parentId: string, name: string): Promise<string> {
    return children(parentId).find((c) => c.dir && c.name === name)?.id ?? (await this.createFolder(name, parentId)).id;
  }

  async listImages(folderId: string): Promise<RemoteImage[]> {
    const out: RemoteImage[] = [];
    const walk = (id: string, path: string[], pathIds: string[]) => {
      for (const c of children(id)) {
        if (c.dir) {
          if (c.name !== META_FOLDER) walk(c.id, [...path, c.name], [...pathIds, c.id]);
        } else if (looksLikeImage(c.name, c.mime)) {
          out.push({ id: c.id, name: c.name, mimeType: c.mime ?? null, size: c.data?.length ?? null, parentId: id, path, pathIds, takenAt: null });
        }
      }
    };
    walk(this.get(folderId).id, [], []);
    return out;
  }

  async upload(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
    const id = `mem-${randomUUID()}`;
    nodes.set(id, { id, name, parent: this.get(folderId).id, dir: false, mime: mimeType, data: Buffer.from(data) });
    return id;
  }

  async putFile(folderId: string, name: string, mimeType: string, data: Buffer): Promise<string> {
    const existing = children(folderId).find((c) => !c.dir && c.name === name);
    if (existing) {
      existing.data = Buffer.from(data);
      existing.mime = mimeType;
      return existing.id;
    }
    return this.upload(folderId, name, mimeType, data);
  }

  async download(fileId: string): Promise<Buffer> {
    return Buffer.from(this.get(fileId).data ?? Buffer.alloc(0));
  }

  async openStream(fileId: string) {
    const n = this.get(fileId);
    return { stream: Readable.from(n.data ?? Buffer.alloc(0)), size: n.data?.length ?? 0, mimeType: n.mime ?? null };
  }

  async trash(fileId: string): Promise<void> {
    const n = nodes.get(fileId);
    if (n) n.trashed = true;
  }
}

/** Test helper: files currently in a folder (by name), including the ".inframe" folder's. */
export function memoryTree(folderId: string): string[] {
  const out: string[] = [];
  const walk = (id: string, prefix: string) => {
    for (const c of children(id)) {
      out.push(`${prefix}${c.name}${c.dir ? "/" : ""}`);
      if (c.dir) walk(c.id, `${prefix}${c.name}/`);
    }
  };
  walk(folderId, "");
  return out.sort();
}
