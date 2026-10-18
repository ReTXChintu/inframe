import { one } from "../db/pool.js";
import { forbidden, notFound } from "../lib/errors.js";

export type Role = "owner" | "cohost" | "member";

export interface EventRow {
  id: string;
  owner_id: string;
  name: string;
  kind: "trip" | "wedding" | "party" | "other";
  starts_on: string | null;
  ends_on: string | null;
  cover_photo_id: string | null;
  join_code: string;
  join_enabled: boolean;
  guest_uploads: boolean;
  guests_see_all: boolean;
  face_search: boolean;
  storage_connection_id: string | null;
  storage_folder_id: string | null;
  storage_folder_name: string | null;
  storage_folder_url: string | null;
  sync_state: "idle" | "syncing" | "error";
  sync_error: string | null;
  last_synced_at: Date | null;
  created_at: Date;
}

export interface EventAccess {
  event: EventRow;
  role: Role;
  isHost: boolean;
  isOwner: boolean;
  /** May browse every photo (not just their own matches / uploads / favourites). */
  canViewAll: boolean;
  canUpload: boolean;
  /** May use face search ("Me" and family tabs). */
  canFaceSearch: boolean;
}

/**
 * The caller's standing in an event. Non-members get a 404 rather than a 403
 * so event ids can't be probed for existence.
 */
export async function eventAccess(eventId: string, userId: string): Promise<EventAccess> {
  const row = await one<EventRow & { role: Role }>(
    `SELECT e.*, m.role FROM events e
       JOIN event_members m ON m.event_id = e.id AND m.user_id = $2
      WHERE e.id = $1`,
    [eventId, userId],
  );
  if (!row) throw notFound("Event");
  const { role, ...event } = row;
  const isHost = role === "owner" || role === "cohost";
  return {
    event,
    role,
    isHost,
    isOwner: role === "owner",
    canViewAll: isHost || event.guests_see_all,
    canUpload: isHost || event.guest_uploads,
    canFaceSearch: isHost || event.face_search,
  };
}

export async function hostAccess(eventId: string, userId: string) {
  const access = await eventAccess(eventId, userId);
  if (!access.isHost) throw forbidden("Only the event's hosts can do that.");
  return access;
}

export async function ownerAccess(eventId: string, userId: string) {
  const access = await eventAccess(eventId, userId);
  if (!access.isOwner) throw forbidden("Only the event owner can do that.");
  return access;
}

/**
 * SQL predicate (on alias `p` = photos) for photos a member may see even when
 * the event hides "All photos": their uploads, their favourites, and photos
 * matched to one of their people. `$userParam` is the placeholder for the user id.
 */
export const ownPhotoPredicate = (userParam: string) => `(
  p.uploader_id = ${userParam}
  OR EXISTS (SELECT 1 FROM favorites fv WHERE fv.photo_id = p.id AND fv.user_id = ${userParam})
  OR EXISTS (SELECT 1 FROM photo_matches pm JOIN people pp ON pp.id = pm.person_id
              WHERE pm.photo_id = p.id AND pp.owner_id = ${userParam})
)`;
