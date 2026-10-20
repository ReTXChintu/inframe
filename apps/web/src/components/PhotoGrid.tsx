import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, Film, Heart, ImageOff, Play } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { api } from "@/lib/api";
import type { Photo, PhotoPage } from "@/lib/types";
import { cx, Spinner } from "./ui";

/** Paged photo feed; `key` must identify the listing (event + view). */
export function usePhotoFeed(key: unknown[], url: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["photos", ...key],
    enabled: Boolean(url),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const sep = url!.includes("?") ? "&" : "?";
      return api<PhotoPage>(`${url}${pageParam ? `${sep}cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const photos = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, photos };
}

interface GridProps {
  photos: Photo[];
  selected: Set<string>;
  onToggle: (photo: Photo, range: boolean) => void;
  onOpen: (index: number) => void;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  /** Show event names on tiles (cross-event feeds). */
  showEvent?: boolean;
}

export function PhotoGrid({ photos, selected, onToggle, onOpen, hasMore, loadMore, loadingMore, showEvent }: GridProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const selecting = selected.size > 0;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !loadingMore && loadMore(), {
      rootMargin: "800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, loadingMore]);

  return (
    <>
      <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8" aria-label="Photos">
        {photos.map((p, i) => {
          const isSelected = selected.has(p.id);
          const mine = p.people.length > 0;
          return (
            <li key={p.id} className="group/tile relative aspect-square [content-visibility:auto] [contain-intrinsic-size:200px]">
              <button
                type="button"
                onClick={(e) => (selecting ? onToggle(p, e.shiftKey) : onOpen(i))}
                className={cx(
                  "group relative block size-full overflow-hidden rounded-[10px] bg-surface-2 transition-transform",
                  isSelected && "scale-[0.92] ring-2 ring-accent ring-offset-2 ring-offset-bg",
                )}
                aria-label={`${p.originalName}${mine ? `, with ${p.people.map((x) => x.name).join(", ")}` : ""}`}
              >
                {p.thumbUrl ? (
                  <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted">
                    {p.mediaType === "video" ? <Film className="size-6" /> : <ImageOff className="size-6" />}
                  </span>
                )}
                {p.mediaType === "video" && (
                  <span className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/55 py-0.5 pr-1.5 pl-1 text-[10px] font-semibold text-white tabular-nums">
                    <Play className="size-3 fill-white" />
                    {formatDuration(p.durationMs) || "Video"}
                  </span>
                )}
                {showEvent && p.eventName && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pt-5 pb-1.5 text-left text-[11px] font-medium text-white">
                    {p.eventName}
                  </span>
                )}
              </button>
              {/* Selection checkbox: always visible while selecting, on hover otherwise */}
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`Select ${p.originalName}`}
                onClick={(e) => onToggle(p, e.shiftKey)}
                className={cx(
                  "absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 transition-opacity",
                  isSelected ? "border-accent bg-accent text-accent-ink" : "border-white/90 bg-black/20 text-transparent",
                  selecting || isSelected ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100",
                )}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </button>
              <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex gap-1">
                {mine && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink shadow" title="You're in this">
                    {p.people.some((x) => x.kind === "self") ? "YOU" : p.people[0]!.name.split(" ")[0]!.toUpperCase()}
                  </span>
                )}
                {p.favorite && <Heart className="size-4 fill-white text-white drop-shadow" aria-label="Favourite" />}
              </span>
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} />
      {loadingMore && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
    </>
  );
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="skeleton aspect-square rounded-[10px]" />
      ))}
    </div>
  );
}
