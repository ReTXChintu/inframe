import type { EventKind, Role } from "./types";

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** "YYYY-MM-DD" (no timezone) → local Date at midnight. */
const fromIso = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y!, m! - 1, dd!);
};

export function formatRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && (!end || end === start)) return dayYear.format(fromIso(start));
  if (!start) return dayYear.format(fromIso(end!));
  const a = fromIso(start);
  const b = fromIso(end!);
  if (a.getFullYear() === b.getFullYear()) return `${day.format(a)} – ${dayYear.format(b)}`;
  return `${dayYear.format(a)} – ${dayYear.format(b)}`;
}

export const formatDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : dayYear.format(new Date(iso));
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const KIND_LABEL: Record<EventKind, string> = { trip: "Trip", wedding: "Wedding", party: "Party", other: "Event" };
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", cohost: "Co-host", member: "Guest" };
export const PROVIDER_LABEL = { gdrive: "Google Drive", mega: "MEGA", memory: "Dev memory storage" } as const;

/** Show a join code as XXXX-XXXX. */
export const prettyCode = (code: string) => code.replace(/(.{4})(?=.)/g, "$1-");

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** 75_000 → "1:15", 3_725_000 → "1:02:05". */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
