import { query } from "../db/pool.js";
import { badRequest } from "../lib/errors.js";
import { photoUrl } from "../lib/media-urls.js";
import { ownPhotoPredicate } from "./access.js";

export interface PhotoRow {
  id: string;
  event_id: string;
  folder_id: string | null;
  uploader_id: string | null;
  uploader_name?: string | null;
  source: "upload" | "storage";
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  taken_at: Date | null;
  sort_at: Date;
  sort_cursor?: string;
  status: "pending" | "processing" | "ready" | "failed";
  face_status: "pending" | "processing" | "done" | "failed";
  face_count: number;
  error: string | null;
  created_at: Date;
  favorite?: boolean;
  people?: { id: string; name: string; kind: "self" | "family" }[];
  event_name?: string;
}

export function serializePhoto(p: PhotoRow) {
  const ready = p.status === "ready";
  return {
    id: p.id,
    eventId: p.event_id,
    eventName: p.event_name,
    folderId: p.folder_id,
    uploaderId: p.uploader_id,
    uploaderName: p.uploader_name ?? null,
    source: p.source,
    originalName: p.original_name,
    sizeBytes: p.size_bytes,
    width: p.width,
    height: p.height,
    takenAt: p.taken_at,
    sortAt: p.sort_at,
    createdAt: p.created_at,
    status: p.status,
    faceStatus: p.face_status,
    faceCount: p.face_count,
    error: p.error,
    favorite: Boolean(p.favorite),
    /** Only the viewer's own people (self / family) — never other guests. */
    people: p.people ?? [],
    thumbUrl: ready ? photoUrl(p.id, "thumb") : null,
    previewUrl: ready ? photoUrl(p.id, "preview") : null,
    originalUrl: ready ? photoUrl(p.id, "original") : null,
  };
}

export type PhotoDto = ReturnType<typeof serializePhoto>;

/** Columns every photo listing selects, for viewer `$1`. */
export const PHOTO_COLUMNS = `
  p.*, p.sort_at::text AS sort_cursor,
  (fv.user_id IS NOT NULL) AS favorite,
  COALESCE((SELECT json_agg(json_build_object('id', pp.id, 'name', pp.name, 'kind', pp.kind) ORDER BY pp.kind DESC, pp.name)
              FROM photo_matches pm JOIN people pp ON pp.id = pm.person_id
             WHERE pm.photo_id = p.id AND pp.owner_id = $1), '[]'::json) AS people`;

export const PHOTO_JOINS = `LEFT JOIN favorites fv ON fv.photo_id = p.id AND fv.user_id = $1`;

function encodeCursor(row: PhotoRow) {
  return Buffer.from(JSON.stringify([row.sort_cursor, row.id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string") {
      return [value[0], value[1]];
    }
  } catch {
    /* fall through */
  }
  throw badRequest("Invalid page cursor.");
}

export interface ListOptions {
  viewerId: string;
  /** Extra SQL conditions on alias `p`; reference params from `$2` onwards. */
  where: string[];
  params: unknown[];
  /** Restrict to the viewer's own photos (uploads / favourites / matches). */
  ownOnly?: boolean;
  /** Join the event name in (for cross-event listings). */
  withEvent?: boolean;
  cursor?: string;
  limit: number;
  order: "newest" | "oldest";
}

/** Keyset-paginated photo listing; only `ready` photos are ever listed. */
export async function listPhotos(o: ListOptions) {
  const params: unknown[] = [o.viewerId, ...o.params];
  const where = ["p.status = 'ready'", ...o.where];
  if (o.ownOnly) where.push(ownPhotoPredicate("$1"));
  const cmp = o.order === "newest" ? "<" : ">";
  const dir = o.order === "newest" ? "DESC" : "ASC";
  if (o.cursor) {
    const [sortAt, id] = decodeCursor(o.cursor);
    params.push(sortAt, id);
    where.push(`(p.sort_at, p.id) ${cmp} ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(o.limit + 1);
  const rows = await query<PhotoRow>(
    `SELECT ${PHOTO_COLUMNS}${o.withEvent ? ", e.name AS event_name" : ""}
       FROM photos p ${PHOTO_JOINS}
       ${o.withEvent ? "JOIN events e ON e.id = p.event_id" : ""}
      WHERE ${where.join(" AND ")}
      ORDER BY p.sort_at ${dir}, p.id ${dir}
      LIMIT $${params.length}`,
    params,
  );
  const hasMore = rows.length > o.limit;
  const page = hasMore ? rows.slice(0, o.limit) : rows;
  return {
    items: page.map(serializePhoto),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}
