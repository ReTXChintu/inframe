import { useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, CircleAlert, ImagePlus, RotateCcw, ScanFace, UploadCloud } from "lucide-react";
import { formatBytes, plural, PROVIDER_LABEL } from "@/lib/format";
import { addFiles, cancelQueued, clearFinished, retry, useUploads, type UploadItem } from "@/lib/uploads";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, cx, EmptyState, LinkButton, SelectField } from "@/components/ui";
import { useEvent } from "./Event";
import { LoadingBlock } from "./Events";

const ACCEPT = "image/*,.heic,.heif";
const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif|tiff?)$/i.test(f.name);

export function UploadPage() {
  const { id } = useParams();
  const { data: event, isLoading } = useEvent(id);
  const items = useUploads(id ?? "");
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [folderId, setFolderId] = useState<string>("");

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

  function take(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    const images = files.filter(isImage);
    if (images.length < files.length) toast(`Skipped ${plural(files.length - images.length, "file")} that aren't photos.`, "info");
    if (images.length) addFiles(event!.id, images, folderId || null);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    take(e.dataTransfer.files);
  };

  const count = (pred: (x: UploadItem) => boolean) => items.filter(pred).length;
  const uploaded = count((x) => !["queued", "uploading"].includes(x.stage) && x.stage !== "failed");
  const done = count((x) => x.stage === "done");
  const matched = count((x) => x.matchCount > 0);
  const failed = count((x) => x.stage === "failed");
  const queued = count((x) => x.stage === "queued");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/events/${event.id}`} className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {event.name}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold">Add photos</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Originals are saved to {event.storage.folderName ? `“${event.storage.folderName}” in ` : ""}
            {event.storage.provider ? PROVIDER_LABEL[event.storage.provider] : "storage"}. Faces are matched as each one arrives.
          </p>
        </div>
        {items.length > 0 && done + failed === items.length && (
          <LinkButton to={`/events/${event.id}`} size="lg">
            Back to the gallery
          </LinkButton>
        )}
      </div>

      {/* Wide screens: drop zone pinned on the left, the per-file list fills the right. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,2fr)_3fr]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-24">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          "frame flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-12 text-center transition-colors lg:min-h-[340px] [--frame-inset:-2px] [--frame-len:26px]",
          drag ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface hover:bg-surface-2",
        )}
      >
        <ImagePlus className="size-10" strokeWidth={1.5} />
        <span className="text-lg font-semibold">Drop photos here, or tap to choose</span>
        <span className="text-[14px] text-muted">JPG, PNG, HEIC and more · as many as you like</span>
        <input ref={input} type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
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
        <div className="hidden h-full min-h-[340px] items-center justify-center rounded-[22px] border border-line bg-surface p-8 text-center text-[15px] text-muted lg:flex">
          Each photo shows up here with its progress — uploading, saving to storage, finding faces.
        </div>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-4 text-[14px]">
            <Stat label="selected" value={items.length} />
            <Stat label="uploaded" value={uploaded} />
            <Stat label="scanned" value={done} />
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
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <UploadRow key={item.key} item={item} />
            ))}
          </ul>
        </Card>
      )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: number; accent?: boolean; danger?: boolean }) {
  return (
    <span className={cx(accent && "text-accent", danger && "text-danger")}>
      <strong className="font-display text-xl tabular-nums">{value}</strong> <span className={cx(!accent && !danger && "text-muted")}>{label}</span>
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
      case "processing":
        return <Badge tone="neutral">Processing…</Badge>;
      case "storing":
        return <Badge tone="neutral">Saving to storage…</Badge>;
      case "finding-faces":
        return (
          <Badge tone="warn">
            <ScanFace className="size-3.5" /> Finding faces…
          </Badge>
        );
      case "done":
        if (item.error) return <Badge tone="warn">Saved · face scan failed</Badge>;
        if (item.matchCount > 0) return <Badge tone="accent"><CheckCircle2 className="size-3.5" /> Matched</Badge>;
        return <Badge tone="ok">{item.faceCount ? plural(item.faceCount, "face") : "No faces"}</Badge>;
      case "failed":
        return <Badge tone="danger"><CircleAlert className="size-3.5" /> Failed</Badge>;
    }
  })();

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {item.previewUrl && <img src={item.previewUrl} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{item.file.name}</p>
        <p className={cx("truncate text-[12px]", item.error ? "text-danger" : "text-muted")}>{item.error ?? formatBytes(item.file.size)}</p>
        {item.stage === "uploading" && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${item.progress * 100}%` }} />
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
