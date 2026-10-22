export interface User {
  id: string;
  email: string;
  name: string;
  /** The first account is the super admin (Admin → Settings). */
  isAdmin: boolean;
  createdAt: string;
}

export type SettingKey =
  | "google.clientId"
  | "google.clientSecret"
  | "smtp.host"
  | "smtp.port"
  | "smtp.secure"
  | "smtp.user"
  | "smtp.pass"
  | "smtp.from"
  | "model.url"
  | "model.apiKey"
  | "model.apiKeyHeader"
  | "model.timeoutMs"
  | "model.matchThreshold";

export interface AdminSettings {
  settings: Record<SettingKey, { value: string | number | boolean | null; set: boolean; source: "admin" | "env" | "default" }>;
  googleRedirectUri: string;
}

export interface Person {
  id: string;
  kind: "self" | "family";
  name: string;
  relation: string | null;
  hasSelfie: boolean;
  enrolledAt: string | null;
  selfieUrl: string | null;
  matchCount: number;
  /** Present on event detail: matches inside that event. */
  eventCount?: number;
}

export interface Me {
  user: User;
  self: Person | null;
  pendingInvites: number;
}

export type EventKind = "trip" | "wedding" | "party" | "other";
export type Role = "owner" | "cohost" | "member";
export type ProviderName = "gdrive" | "mega" | "memory";

/** Another app of the suite that created and steers the event (Trippin). `linked: false` once it was unlinked. */
export interface ExternalLink {
  source: "trippin";
  url: string | null;
  linked: boolean;
}

export interface EventSummary {
  id: string;
  name: string;
  kind: EventKind;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
  role: Role;
  photoCount: number;
  memberCount: number;
  myCount: number;
  coverUrl: string | null;
  provider: ProviderName | null;
  /** No storage folder picked yet: nothing can be added until the owner connects one. */
  storagePending: boolean;
  external: ExternalLink | null;
}

export interface Folder {
  id: string;
  name: string;
  count: number;
}

export interface GuestAllowance {
  maxItems: number | null;
  maxBytes: number | null;
  usedItems: number;
  usedBytes: number;
}

/** Files and bytes a guest may still add; null on a side that isn't limited. */
export function allowanceLeft(a: GuestAllowance) {
  const clamp = (max: number | null, used: number) => (max === null ? null : Math.max(0, max - used));
  const items = clamp(a.maxItems, a.usedItems);
  const bytes = clamp(a.maxBytes, a.usedBytes);
  return { items, bytes, limited: items !== null || bytes !== null, exhausted: items === 0 || bytes === 0 };
}

export interface EventDetail {
  id: string;
  name: string;
  kind: EventKind;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: string;
  owner: { id: string; name: string };
  role: Role;
  isHost: boolean;
  isOwner: boolean;
  can: { viewAll: boolean; upload: boolean; faceSearch: boolean };
  settings: {
    joinEnabled: boolean;
    guestUploads: boolean;
    guestsSeeAll: boolean;
    faceSearch: boolean;
    /** What each guest may add in all; null = no limit. */
    guestMaxItems: number | null;
    guestMaxBytes: number | null;
  };
  /** This viewer's share of the per-guest allowance; null for hosts, who have no cap. */
  guestAllowance: GuestAllowance | null;
  joinCode: string | null;
  coverPhotoId: string | null;
  coverUrl: string | null;
  external: ExternalLink | null;
  storage: {
    connected: boolean;
    /** No folder picked yet (Trippin-created events start this way). */
    pending: boolean;
    provider: ProviderName | null;
    folderName: string | null;
    accountLabel: string | null;
    folderUrl: string | null;
    connectionId: string | null;
    status: "ok" | "error" | null;
    error: string | null;
    syncState: "idle" | "syncing" | "error";
    syncError: string | null;
    lastSyncedAt: string | null;
  };
  counts: {
    all: number | null;
    me: number;
    favorites: number;
    uploads: number;
    members: number;
    failed: number | null;
    processing: number | null;
  };
  folders: Folder[];
  people: Person[];
}

export interface Photo {
  id: string;
  eventId: string;
  eventName?: string;
  folderId: string | null;
  uploaderId: string | null;
  uploaderName: string | null;
  source: "upload" | "storage";
  mediaType: "image" | "video";
  durationMs: number | null;
  originalName: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  sortAt: string;
  createdAt: string;
  status: "pending" | "processing" | "ready" | "failed";
  faceStatus: "pending" | "processing" | "done" | "failed" | "skipped";
  faceCount: number;
  error: string | null;
  favorite: boolean;
  people: { id: string; name: string; kind: "self" | "family" }[];
  thumbUrl: string | null;
  previewUrl: string | null;
  originalUrl: string | null;
}

export interface PhotoDetail extends Photo {
  folderName: string | null;
  canDelete: boolean;
  canSetCover: boolean;
}

export interface PhotoPage {
  items: Photo[];
  nextCursor: string | null;
}

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  joinedAt: string;
  isYou: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: "cohost" | "member";
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
}

export interface MyInvite {
  id: string;
  role: "cohost" | "member";
  createdAt: string;
  invitedBy: string | null;
  eventId: string;
  eventName: string;
  eventKind: EventKind;
  startsOn: string | null;
  endsOn: string | null;
}

export interface EventPreview {
  id: string;
  name: string;
  kind: EventKind;
  startsOn: string | null;
  endsOn: string | null;
  ownerName: string;
  memberCount: number;
}

export interface Connection {
  id: string;
  provider: ProviderName;
  accountLabel: string;
  status: "ok" | "error";
  lastError: string | null;
  createdAt: string;
  eventCount: number;
}
