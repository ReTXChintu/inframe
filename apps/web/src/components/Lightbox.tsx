import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Film, Heart, ImageIcon, Info, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import type { Photo, PhotoDetail } from "@/lib/types";
import { errorMessage, useFeedback } from "./feedback";
import { usePhotoActions } from "./photoActions";
import { cx, IconButton, Spinner } from "./ui";

interface Props {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Near the end of what's loaded: fetch more so "next" keeps working. */
  onNeedMore?: () => void;
}

export function Lightbox({ photos, index, onIndex, onClose, onNeedMore }: Props) {
  const photo = photos[index];
  const dialog = useRef<HTMLDialogElement>(null);
  const filmstrip = useRef<HTMLDivElement>(null);
  const [showInfo, setShowInfo] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [loaded, setLoaded] = useState(false);
  const { favorite, download, confirmDelete } = usePhotoActions();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const touchX = useRef<number | null>(null);

  const detail = useQuery({
    queryKey: ["photo", photo?.id],
    enabled: Boolean(photo),
    queryFn: () => api<{ photo: PhotoDetail }>(`/api/photos/${photo!.id}`).then((r) => r.photo),
  });

  const setCover = useMutation({
    mutationFn: () => api(`/api/events/${photo!.eventId}`, { method: "PATCH", body: { coverPhotoId: photo!.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", photo!.eventId] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast("Set as the event cover.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    setLoaded(false);
    if (index >= photos.length - 4) onNeedMore?.();
    filmstrip.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    // Warm the cache for the neighbours.
    for (const n of [index - 1, index + 1]) {
      const url = photos[n]?.previewUrl;
      if (url) new Image().src = url;
    }
  }, [index, photos, onNeedMore]);

  const prev = () => index > 0 && onIndex(index - 1);
  const next = () => index < photos.length - 1 && onIndex(index + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key.toLowerCase() === "f" && photo) favorite.mutate({ ids: [photo.id], value: !(detail.data?.favorite ?? photo.favorite) });
      else if (e.key.toLowerCase() === "i") setShowInfo((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!photo) return null;
  const d = detail.data;
  const isFav = d?.favorite ?? photo.favorite;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={photo.originalName}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-stage p-0 text-white backdrop:bg-black"
    >
      <div className="flex h-full">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
            <IconButton label="Close" variant="glass" onClick={onClose}>
              <X className="size-5" />
            </IconButton>
            <p className="num ml-1 truncate text-body-s text-white/70">
              {index + 1} of {photos.length}
            </p>
            <div className="ml-auto flex items-center gap-1.5">
              <IconButton label={isFav ? "Remove from favourites" : "Add to favourites"} variant="glass" onClick={() => favorite.mutate({ ids: [photo.id], value: !isFav })}>
                <Heart className={cx("size-5", isFav && "fill-stage-ac text-stage-ac")} />
              </IconButton>
              <IconButton
                label="Download original"
                variant="glass"
                onClick={() => {
                  if (photo.originalUrl) window.location.assign(`${photo.originalUrl}&dl=1`);
                  else download([photo.id]);
                }}
              >
                <Download className="size-5" />
              </IconButton>
              {d?.canDelete && (
                <IconButton label="Delete" variant="glass" onClick={() => confirmDelete([photo.id], () => (photos.length > 1 ? onIndex(Math.max(0, index - 1)) : onClose()))}>
                  <Trash2 className="size-5" />
                </IconButton>
              )}
              <IconButton label="Details" variant="glass" onClick={() => setShowInfo((v) => !v)} aria-pressed={showInfo}>
                <Info className="size-5" />
              </IconButton>
            </div>
          </div>

          {/* Stage */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16"
            onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
            onTouchEnd={(e) => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0]!.clientX - touchX.current;
              if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
              touchX.current = null;
            }}
          >
            {photo.mediaType === "video" ? (
              photo.originalUrl ? (
                <video
                  key={photo.id}
                  src={photo.originalUrl}
                  poster={photo.previewUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-full max-w-full bg-black"
                />
              ) : (
                <p className="text-[14px] text-white/60">This video is still being saved to storage.</p>
              )
            ) : (
              !loaded && <Spinner onDark className="absolute" />
            )}
            {photo.mediaType !== "video" && photo.previewUrl && (
              <img
                key={photo.id}
                src={photo.previewUrl}
                alt={photo.originalName}
                onLoad={() => setLoaded(true)}
                className={cx("max-h-full max-w-full object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
              />
            )}
            <button
              aria-label="Previous photo"
              onClick={prev}
              disabled={index === 0}
              className="absolute left-2 hidden size-11 items-center justify-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20 disabled:opacity-0 sm:flex"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              aria-label="Next photo"
              onClick={next}
              disabled={index === photos.length - 1}
              className="absolute right-2 hidden size-11 items-center justify-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20 disabled:opacity-0 sm:flex"
            >
              <ChevronRight className="size-6" />
            </button>
          </div>

          {/* Filmstrip */}
          <div ref={filmstrip} className="hidden gap-1.5 overflow-x-auto px-4 py-3 sm:flex [scrollbar-width:none]">
            {photos.map((p, i) => (
              <button
                key={p.id}
                data-i={i}
                onClick={() => onIndex(i)}
                aria-label={`Photo ${i + 1}`}
                aria-current={i === index}
                className={cx("grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-white/5 transition-opacity", i === index ? "ring-2 ring-stage-ac" : "opacity-50 hover:opacity-90")}
              >
                {p.thumbUrl ? (
                  <img src={p.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  p.mediaType === "video" && <Film className="m-auto size-5 text-white/60" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        {showInfo && (
          <aside className="absolute inset-x-0 bottom-0 max-h-[55dvh] overflow-y-auto rounded-t-3xl bg-stage-sf p-5 lg:static lg:max-h-none lg:w-80 lg:rounded-none lg:border-l lg:border-white/10">
            <h2 className="truncate font-mono text-[14px] font-medium">{photo.originalName}</h2>
            {photo.people.length > 0 && (
              <div className="mt-4">
                <p className="text-label text-white/60">In this photo</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {photo.people.map((p) => (
                    <span key={p.id} className="inline-flex h-6 items-center rounded-sm bg-stage-ac px-2 text-xs font-semibold text-stage-ac-tx">
                      {p.kind === "self" ? "You" : p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <dl className="num mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-body-s">
              <dt className="text-white/50">Taken</dt>
              <dd>{formatDateTime(photo.takenAt)}</dd>
              <dt className="text-white/50">Added by</dt>
              <dd>{d ? (d.uploaderName ?? (photo.source === "storage" ? "Storage folder" : "—")) : "…"}</dd>
              {d?.folderName && (
                <>
                  <dt className="text-white/50">Album</dt>
                  <dd>{d.folderName}</dd>
                </>
              )}
              <dt className="text-white/50">Size</dt>
              <dd>
                {photo.width && photo.height ? `${photo.width} × ${photo.height} · ` : ""}
                {formatBytes(photo.sizeBytes)}
              </dd>
              {photo.mediaType === "video" && photo.durationMs ? (
                <>
                  <dt className="text-white/50">Length</dt>
                  <dd>{formatDuration(photo.durationMs)}</dd>
                </>
              ) : null}
              <dt className="text-white/50">Faces</dt>
              <dd>
                {photo.faceStatus === "skipped"
                  ? "Not scanned (video)"
                  : photo.faceStatus === "done"
                    ? photo.faceCount
                    : photo.faceStatus === "failed"
                      ? "Couldn't scan"
                      : "Scanning…"}
              </dd>
            </dl>
            {d?.canSetCover && photo.thumbUrl && (
              <button
                onClick={() => setCover.mutate()}
                className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-white/10 px-3 text-[13px] font-semibold hover:bg-white/20"
              >
                <ImageIcon className="size-4" /> Use as event cover
              </button>
            )}
          </aside>
        )}
      </div>
    </dialog>
  );
}
