import { ExternalLink as ExternalLinkIcon, FolderPlus, HardDrive, Map as MapIcon } from "lucide-react";
import type { EventDetail, ExternalLink } from "@/lib/types";
import { cx, LinkButton } from "./ui";

/**
 * "Planned in Trippin" (links to the trip) on a linked event; "Was linked to
 * Trippin" once it's been unlinked and is a normal event again.
 */
export function TrippinChip({
  link,
  className,
  plain = false,
}: {
  link: ExternalLink | null;
  className?: string;
  /** Not a link itself (e.g. inside a card that already is one). */
  plain?: boolean;
}) {
  if (!link || link.source !== "trippin") return null;
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium";
  if (!link.linked) {
    return (
      <span className={cx(base, "bg-surface-2 text-muted", className)}>
        <MapIcon className="size-3.5" aria-hidden /> Was linked to Trippin
      </span>
    );
  }
  if (!link.url || plain) {
    return (
      <span className={cx(base, "bg-accent-soft text-accent", className)}>
        <MapIcon className="size-3.5" aria-hidden /> Planned in Trippin
      </span>
    );
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      title="Open the trip in Trippin"
      className={cx(base, "bg-accent-soft text-accent hover:underline", className)}
    >
      <MapIcon className="size-3.5" aria-hidden /> Planned in Trippin <ExternalLinkIcon className="size-3" aria-hidden />
    </a>
  );
}

/** What everyone sees while the event has no storage folder yet. Only the owner can fix it. */
export const storagePendingMessage = (isOwner: boolean) =>
  isOwner ? "Connect a folder to start adding photos" : "Photos will appear once the owner connects a folder.";

export function StoragePendingBanner({ event }: { event: EventDetail }) {
  if (!event.storage.pending) return null;
  if (!event.isOwner) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-ink-2 animate-rise">
        <HardDrive className="size-5 shrink-0 text-muted" aria-hidden />
        <p>{storagePendingMessage(false)}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-[20px] border border-accent/30 bg-accent-soft p-5 sm:flex-row sm:items-center sm:p-6 animate-rise">
      <FolderPlus className="size-8 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">{storagePendingMessage(true)}</p>
        <p className="text-[14px] text-ink-2">
          Pick a Google Drive or MEGA folder for the originals. Everyone in the event can add photos as soon as it's set.
        </p>
      </div>
      <LinkButton to={`/events/${event.id}/settings?connect=1#storage`} icon={<FolderPlus className="size-4" />}>
        Connect a folder
      </LinkButton>
    </div>
  );
}
