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

/** Bleeds through the shell's side padding (16 / 24 / 32) so the photos run edge to edge. */
const GRID =
  "-mx-4 grid grid-cols-3 gap-0.5 sm:-mx-6 sm:grid-cols-4 md:grid-cols-5 lg:-mx-8 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 min-[1800px]:grid-cols-10";

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
      {/* Photos are the hero: a dense grid, edge to edge (it bleeds through the page padding), 2 px gutters. */}
      <ul className={GRID} aria-label="Photos">
        {photos.map((p, i) => {
          const isSelected = selected.has(p.id);
          const mine = p.people.length > 0;
          return (
            <li key={p.id} className="group/tile relative aspect-square [content-visibility:auto] [contain-intrinsic-size:200px]">
              <button
                type="button"
                onClick={(e) => (selecting ? onToggle(p, e.shiftKey) : onOpen(i))}
                className={cx(
                  "group relative block size-full overflow-hidden bg-sunk transition-[transform,border-radius] duration-200 ease-ds focus-visible:outline-offset-[-3px]",
                  isSelected && "scale-[0.86] rounded-md shadow-[0_0_0_2px_var(--ac)]",
                )}
                aria-label={`${p.originalName}${mine ? `, with ${p.people.map((x) => x.name).join(", ")}` : ""}`}
              >
                {p.thumbUrl ? (
                  <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-tx3">
                    {p.mediaType === "video" ? <Film className="size-6" /> : <ImageOff className="size-6" />}
                  </span>
                )}
                {p.mediaType === "video" && (
                  <span className="num pointer-events-none absolute top-1.5 right-1.5 flex h-5 items-center gap-0.5 rounded-sm bg-black/55 pr-1.5 pl-1 text-[11px] font-semibold text-white">
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
              {/* Selection checkbox (§7.2 custom checkbox, in a 40 px hit area): always visible while selecting, on hover otherwise */}
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`Select ${p.originalName}`}
                onClick={(e) => onToggle(p, e.shiftKey)}
                className={cx(
                  "absolute top-0 left-0 flex size-10 items-center justify-center transition-opacity focus-visible:outline-offset-[-3px]",
                  selecting || isSelected ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100",
                )}
              >
                <span
                  className={cx(
                    "flex size-[22px] items-center justify-center rounded-[7px] border-[1.5px]",
                    isSelected ? "border-ac bg-ac text-ac-tx" : "border-white bg-black/25 text-transparent",
                  )}
                >
                  <Check className="size-3.5" />
                </span>
              </button>
              <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1">
                {mine && (
                  <span className="inline-flex h-[18px] items-center rounded-xs bg-ac px-1.5 text-[11px] font-semibold text-ac-tx" title="You're in this">
                    {p.people.some((x) => x.kind === "self") ? "You" : p.people[0]!.name.split(" ")[0]!}
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
    <div className={GRID} aria-busy="true" aria-label="Loading photos">
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="skeleton aspect-square" />
      ))}
    </div>
  );
}
