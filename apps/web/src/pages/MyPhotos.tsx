import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Images, ScanFace } from "lucide-react";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Person } from "@/lib/types";
import { errorMessage } from "@/components/feedback";
import { Lightbox } from "@/components/Lightbox";
import { GridSkeleton, PhotoGrid, usePhotoFeed } from "@/components/PhotoGrid";
import { SelectionBar } from "@/components/SelectionBar";
import { Avatar, cx, EmptyState, ErrorBanner, LinkButton } from "@/components/ui";

/** Every photo you (or a family member) are in, across all your events. */
export function MyPhotosPage() {
  const people = useQuery({ queryKey: ["people"], queryFn: () => api<{ people: Person[] }>("/api/people").then((r) => r.people) });
  const enrolled = (people.data ?? []).filter((p) => p.hasSelfie);
  const [personId, setPersonId] = useState<string | null>(null);
  const active = enrolled.find((p) => p.id === personId) ?? enrolled.find((p) => p.kind === "self") ?? enrolled[0];
  const feed = usePhotoFeed(["mine", active?.id], active ? `/api/me/photos?personId=${active.id}` : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (people.isLoading) return <GridSkeleton />;

  if (!enrolled.length) {
    return (
      <EmptyState
        icon={<ScanFace className="size-8" />}
        title="Add a selfie to see your photos"
        body="InFrame looks for you in every event you join. Add your selfie (and your family's) on the People page."
        action={<LinkButton to="/people">Go to People</LinkButton>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title-page">My photos</h1>
        <p className="mt-1 text-body-l text-tx2">From every event you're part of.</p>
      </div>
      {enrolled.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist" aria-label="Whose photos">
          {enrolled.map((p) => {
            const on = p.id === active?.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setPersonId(p.id);
                  setSelected(new Set());
                }}
                className={cx(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border py-1 pr-3.5 pl-1 text-[13px] font-medium transition-colors duration-[120ms]",
                  on ? "border-tx bg-tx text-bg" : "border-ln2 bg-sf text-tx hover:bg-sf2",
                )}
              >
                <Avatar name={p.name} src={p.selfieUrl} size={30} />
                {p.kind === "self" ? "You" : p.name}
                <span className={cx("num font-semibold", on ? "text-bg/70" : "text-tx3")}>{p.matchCount}</span>
              </button>
            );
          })}
        </div>
      )}
      {feed.isLoading ? (
        <GridSkeleton />
      ) : feed.error ? (
        <ErrorBanner>{errorMessage(feed.error)}</ErrorBanner>
      ) : feed.photos.length === 0 ? (
        <EmptyState
          icon={<Images className="size-8" />}
          title={`No photos of ${active?.kind === "self" ? "you" : active?.name} yet`}
          body="They'll appear here as soon as someone adds a photo to one of your events."
        />
      ) : (
        <>
          <p className="num text-body-s text-tx3">
            {plural(feed.photos.length, "photo")}
            {feed.hasNextPage ? "+" : ""}
          </p>
          <PhotoGrid
            photos={feed.photos}
            selected={selected}
            onToggle={(p) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(p.id)) n.delete(p.id);
                else n.add(p.id);
                return n;
              })
            }
            onOpen={setLightbox}
            hasMore={Boolean(feed.hasNextPage)}
            loadMore={() => feed.fetchNextPage()}
            loadingMore={feed.isFetchingNextPage}
            showEvent
          />
        </>
      )}
      <SelectionBar
        selected={selected}
        photos={feed.photos}
        canDelete={false}
        onClear={() => setSelected(new Set())}
        onSelectAll={() => setSelected(new Set(feed.photos.map((p) => p.id)))}
      />
      {lightbox !== null && feed.photos[lightbox] && (
        <Lightbox
          photos={feed.photos}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onNeedMore={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        />
      )}
    </div>
  );
}
