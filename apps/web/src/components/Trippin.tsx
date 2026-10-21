import { ExternalLink as ExternalLinkIcon, FolderPlus, HardDrive, Map as MapIcon } from "lucide-react";
import type { EventDetail, ExternalLink } from "@/lib/types";
import { Callout, cx, LinkButton } from "./ui";

/**
 * "Planned in Trippin" (links to the trip) on a linked event; "Was linked to
 * Trippin" once it's been unlinked and is a normal event again.
 * Styled as the design system's badges: accent for a live link, outline once unlinked.
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
  const base = "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap";
  if (!link.linked) {
    return (
      <span className={cx(base, "text-tx2 shadow-[inset_0_0_0_1px_var(--ln2)]", className)}>
        <MapIcon className="size-3.5" aria-hidden /> Was linked to Trippin
      </span>
    );
  }
  if (!link.url || plain) {
    return (
      <span className={cx(base, "bg-ac-soft text-ac", className)}>
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
      className={cx(base, "bg-ac-soft text-ac transition-shadow hover:shadow-[inset_0_0_0_1px_var(--ac-line)]", className)}
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
      <Callout tone="neutral" icon={<HardDrive />} className="animate-rise">
        {storagePendingMessage(false)}
      </Callout>
    );
  }
  return (
    <Callout
      tone="warn"
      icon={<FolderPlus />}
      title={storagePendingMessage(true)}
      className="animate-rise"
      action={
        <LinkButton to={`/events/${event.id}/settings?connect=1#storage`} icon={<FolderPlus className="size-[18px]" />}>
          Connect a folder
        </LinkButton>
      }
    >
      <span className="text-tx2">
        Pick a Google Drive or MEGA folder for the originals. Everyone in the event can add photos as soon as it's set.
      </span>
    </Callout>
  );
}
