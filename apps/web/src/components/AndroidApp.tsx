import { Smartphone } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { useAndroidApp } from "@/lib/androidApp";
import { Card, cx } from "./ui";

/** Compact header/menu link to the APK. Renders nothing until a release has published one. */
export function AndroidAppLink({ className, label = "Get the app" }: { className?: string; label?: string }) {
  const { data } = useAndroidApp();
  if (!data) return null;
  return (
    <a
      href={data.url}
      download
      title={`Download InFrame for Android ${data.version} (${formatBytes(data.size)})`}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2",
        className,
      )}
    >
      <Smartphone className="size-4" />
      {label}
    </a>
  );
}

/** Settings card with version, size and install notes. */
export function AndroidAppCard() {
  const { data } = useAndroidApp();
  if (!data) return null;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-bg">
        <Smartphone className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">InFrame for Android</h2>
        <p className="mt-0.5 text-[14px] text-muted">
          Version {data.version} · {formatBytes(data.size)}. Take selfies with your camera, scan join QR codes and upload straight from
          your gallery. If Android asks, allow installing apps from your browser.
        </p>
      </div>
      <a
        href={data.url}
        download
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-bg hover:bg-ink-2"
      >
        <Smartphone className="size-4" /> Download APK
      </a>
    </Card>
  );
}
