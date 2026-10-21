import { CheckSquare, Download, Heart, Trash2, X } from "lucide-react";
import { plural } from "@/lib/format";
import type { Photo } from "@/lib/types";
import { usePhotoActions } from "./photoActions";
import { cx } from "./ui";

/** Floating action pill shown while photos are selected. */
export function SelectionBar({
  selected,
  photos,
  canDelete,
  onClear,
  onSelectAll,
}: {
  selected: Set<string>;
  photos: Photo[];
  /** Can the viewer delete every selected photo? */
  canDelete: boolean;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  const { favorite, download, confirmDelete, remove } = usePhotoActions();
  if (selected.size === 0) return null;
  const ids = [...selected];
  const allFav = photos.filter((p) => selected.has(p.id)).every((p) => p.favorite);

  // Inverse floating bar, built like the §7.12 toast: --tx fill, --bg text, radius 12, the floating shadow.
  const action = "inline-flex h-10 items-center gap-2 rounded-md px-3 text-[13px] font-semibold transition-colors hover:bg-bg/10 disabled:opacity-40";
  return (
    <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6 lg:pl-[264px]">
      <div role="toolbar" aria-label="Selected photos" className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-tx p-1.5 text-bg shadow-2 animate-rise">
        <button className={action} onClick={onClear} aria-label="Clear selection">
          <X className="size-4" />
          <span className="num">{plural(selected.size, "selected", "selected")}</span>
        </button>
        <span className="mx-1 h-6 w-px bg-bg/20" />
        {selected.size < photos.length && (
          <button className={cx(action, "hidden sm:inline-flex")} onClick={onSelectAll}>
            <CheckSquare className="size-4" /> Select all
          </button>
        )}
        <button className={action} onClick={() => favorite.mutate({ ids, value: !allFav })} disabled={favorite.isPending}>
          <Heart className={cx("size-4", allFav && "fill-current")} />
          <span className="hidden sm:inline">{allFav ? "Unfavourite" : "Favourite"}</span>
        </button>
        <button className={action} onClick={() => download(ids)} disabled={ids.length > 500} title={ids.length > 500 ? "Up to 500 at a time" : undefined}>
          <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
        </button>
        {canDelete && (
          <button className={cx(action, "text-crit-soft")} onClick={() => confirmDelete(ids, onClear)} disabled={remove.isPending}>
            <Trash2 className="size-4" /> <span className="hidden sm:inline">Delete</span>
          </button>
        )}
      </div>
    </div>
  );
}
