import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, CircleAlert, Film, ImagePlus, RotateCcw, ScanFace, UploadCloud } from "lucide-react";
import { formatBytes, plural, PROVIDER_LABEL } from "@/lib/format";
import { addFiles, cancelQueued, clearFinished, fileKey, findDuplicates, isVideoFile, retry, useUploads, type UploadItem } from "@/lib/uploads";
import { errorMessage, useFeedback } from "@/components/feedback";
import { Badge, Button, Card, cx, EmptyState, IconTile, LinkButton, Modal, SelectField } from "@/components/ui";
import { useEvent } from "./Event";
import { LoadingBlock } from "./Events";

const ACCEPT = "image/*,video/*,.heic,.heif";
const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif|tiff?|bmp|dng)$/i.test(f.name);
const isMedia = (f: File) => isImage(f) || isVideoFile(f);

export function UploadPage() {
  const { id } = useParams();
  const { data: event, isLoading } = useEvent(id);
  const items = useUploads(id ?? "");
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [folderId, setFolderId] = useState<string>("");
  const [checking, setChecking] = useState(false);
  // Files that look like ones already in the event, waiting on "skip or upload anyway".
  const [dupes, setDupes] = useState<{ files: File[]; keys: Set<string> } | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (!event) return <EmptyState icon={<UploadCloud className="size-8" />} title="Event not found" />;
  if (!event.can.upload) {
    return (
      <EmptyState
        icon={<UploadCloud className="size-8" />}
        title="Uploads are off"
        body={event.storage.connected ? "Only the hosts can add photos to this event." : "This event has no storage folder connected yet."}
        action={<LinkButton to={`/events/${event.id}`} variant="secondary">Back to the event</LinkButton>}
      />
    );
  }

  async function take(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    const media = files.filter(isMedia);
    if (media.length < files.length) toast(`Skipped ${plural(files.length - media.length, "file")} that aren't photos or videos.`, "info");
    if (!media.length) return;
    setChecking(true);
    try {
      // Same name + size + last-modified as something already in the event = the same file, most likely.
      const keys = await findDuplicates(event!.id, media);
      if (media.some((f) => keys.has(fileKey(f)))) setDupes({ files: media, keys });
      else addFiles(event!.id, media, folderId || null);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setChecking(false);
    }
  }

  function settleDupes(skip: boolean) {
    if (!dupes) return;
    const files = skip ? dupes.files.filter((f) => !dupes.keys.has(fileKey(f))) : dupes.files;
    if (files.length) addFiles(event!.id, files, folderId || null);
    else toast("Nothing new to upload — they're all here already.", "info");
    setDupes(null);
  }

  const dupeList = dupes ? dupes.files.filter((f) => dupes.keys.has(fileKey(f))) : [];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void take(e.dataTransfer.files);
  };

  const count = (pred: (x: UploadItem) => boolean) => items.filter(pred).length;
  const uploaded = count((x) => !["queued", "uploading"].includes(x.stage) && x.stage !== "failed");
  const done = count((x) => x.stage === "done");
  const matched = count((x) => x.matchCount > 0);
  const failed = count((x) => x.stage === "failed");
  const queued = count((x) => x.stage === "queued");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/events/${event.id}`} className="inline-flex items-center gap-1.5 rounded-md text-body font-medium text-tx2 hover:text-tx">
            <ArrowLeft className="size-4" /> {event.name}
          </Link>
          <h1 className="mt-2 text-title-page">Add photos & videos</h1>
          <p className="mt-1 text-body-l text-tx2">
            Originals are saved to {event.storage.folderName ? `“${event.storage.folderName}” in ` : ""}
            {event.storage.provider ? PROVIDER_LABEL[event.storage.provider] : "storage"}. Photos are scanned for faces; videos are
            stored as they are. Once a file shows “Queued on server”, you can close this tab.
          </p>
        </div>
        {items.length > 0 && done + failed === items.length && (
          <LinkButton to={`/events/${event.id}`} size="lg">
            Back to the gallery
          </LinkButton>
        )}
      </div>

      {/* Wide screens: drop zone pinned on the left, the per-file list fills the right. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,2fr)_3fr]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          "flex cursor-pointer flex-col has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ac items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed px-6 py-12 text-center transition-colors duration-[120ms] lg:min-h-[340px]",
          drag ? "border-ac bg-ac-soft" : "border-ln2 bg-sf hover:bg-sf2",
        )}
      >
        <IconTile tone="accent" size={48}><ImagePlus /></IconTile>
        <span className="text-title-card">{checking ? "Checking for duplicates…" : "Drop photos and videos here, or tap to choose"}</span>
        <span className="text-body-s text-tx3">JPG, PNG, HEIC, MP4, MOV and more · as many as you like</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            const el = e.currentTarget;
            void take(el.files).finally(() => (el.value = ""));
          }}
        />
      </label>

      {event.can.viewAll && event.folders.length > 0 && (
        <SelectField label="Add to album" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">No album</option>
          {event.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </SelectField>
      )}
      </div>

      {items.length === 0 ? (
        <div className="hidden h-full min-h-[340px] items-center justify-center rounded-xl border border-dashed border-ln2 p-8 text-center text-body text-tx2 lg:flex">
          Each file shows up here with its progress — uploading, saving to storage, finding faces.
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ln px-5 py-4 text-body-s">
            <Stat label="selected" value={items.length} />
            <Stat label="uploaded" value={uploaded} />
            <Stat label="finished" value={done} />
            <Stat label="with you or family" value={matched} accent />
            {failed > 0 && <Stat label="failed" value={failed} danger />}
            <div className="ml-auto flex gap-2">
              {queued > 0 && (
                <Button size="sm" variant="ghost" onClick={() => cancelQueued(event.id)}>
                  Cancel {queued} waiting
                </Button>
              )}
              {(done > 0 || failed > 0) && (
                <Button size="sm" variant="secondary" onClick={() => clearFinished(event.id)}>
                  Clear finished
                </Button>
              )}
            </div>
          </div>
          <ul className="divide-y divide-ln">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </Card>
      )}
      </div>

      <Modal
        open={!!dupes}
        onClose={() => setDupes(null)}
        title={`${plural(dupeList.length, "file")} already here`}
        footer={
          <>
            <Button variant="ghost" size="lg" onClick={() => setDupes(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="lg" onClick={() => settleDupes(false)}>
              Upload anyway
            </Button>
            <Button size="lg" onClick={() => settleDupes(true)}>Skip duplicates</Button>
          </>
        }
      >
        <p className="text-body-l text-tx2">
          {dupeList.length === dupes?.files.length ? "All of them have" : `${dupeList.length} of ${dupes?.files.length} have`} the same
          name, size and date as files already in this event (or already uploading).
        </p>
        <ul className="mt-3 max-h-56 divide-y divide-ln overflow-y-auto rounded-lg border border-ln text-body-s">
          {dupeList.slice(0, 200).map((f) => (
            <li key={fileKey(f)} className="flex justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 truncate font-mono text-[13px]">{f.name}</span>
              <span className="num shrink-0 text-tx3">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: number; accent?: boolean; danger?: boolean }) {
  return (
    <span className={cx("inline-flex items-baseline gap-1.5", accent && "text-ac", danger && "text-crit")}>
      <strong className="num text-title-section">{value}</strong> <span className={cx(!accent && !danger && "text-tx2")}>{label}</span>
    </span>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const status = (() => {
    switch (item.stage) {
      case "queued":
        return <Badge>Waiting</Badge>;
      case "uploading":
        return <Badge tone="neutral">Uploading {Math.round(item.progress * 100)}%</Badge>;
      case "received":
        return <Badge tone="neutral">Queued on server</Badge>;
      case "processing":
        return <Badge tone="neutral">Making previews…</Badge>;
      case "storing":
        return <Badge tone="neutral">Saving to storage…</Badge>;
      case "finding-faces":
        return (
          <Badge tone="warn">
            <ScanFace className="size-3.5" /> Finding faces…
          </Badge>
        );
      case "done":
        if (item.isVideo) return <Badge tone="ok"><CheckCircle2 className="size-3.5" /> Stored</Badge>;
        if (item.error) return <Badge tone="warn">Saved · face scan failed</Badge>;
        if (item.matchCount > 0) return <Badge tone="accent"><CheckCircle2 className="size-3.5" /> Matched</Badge>;
        return <Badge tone="ok">{item.faceCount ? plural(item.faceCount, "face") : "No faces"}</Badge>;
      case "failed":
        return <Badge tone="danger"><CircleAlert className="size-3.5" /> Failed</Badge>;
    }
  })();

  return (
    <li className="flex items-center gap-3 min-h-16 px-5 py-3">
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-sunk text-tx3">
        {item.previewUrl ? <img src={item.previewUrl} alt="" className="size-full object-cover" /> : item.isVideo && <Film className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] font-medium">{item.file.name}</p>
        <p className={cx("num truncate text-caption", item.error ? "text-crit" : "text-tx3")}>{item.error ?? formatBytes(item.file.size)}</p>
        {item.stage === "uploading" && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-sunk">
            <div className="h-full rounded-[3px] bg-ac transition-[width]" style={{ width: `${item.progress * 100}%` }} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status}
        {(item.stage === "failed" || (item.stage === "done" && item.error)) && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => retry(item.key)}>
            Retry
          </Button>
        )}
      </div>
    </li>
  );
}
