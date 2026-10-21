import { Download, Smartphone } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { useAndroidApp } from "@/lib/androidApp";
import { Card, cx, IconTile } from "./ui";

/**
 * Compact link to the APK. Renders nothing until a release has published one.
 * `button`: a 36 px secondary button; `menu`: a full-width row inside a menu or sidebar.
 */
export function AndroidAppLink({
  className,
  label = "Get the app",
  look = "button",
}: {
  className?: string;
  label?: string;
  look?: "button" | "menu";
}) {
  const { data } = useAndroidApp();
  if (!data) return null;
  return (
    <a
      href={data.url}
      download
      title={`Download InFrame for Android ${data.version} (${formatBytes(data.size)})`}
      className={cx(
        look === "button"
          ? "inline-flex h-9 items-center gap-2 rounded-md border border-ln2 bg-sf px-3 text-[13px] font-semibold text-tx transition-colors hover:bg-sf2"
          : "flex h-10 w-full items-center gap-3 rounded-md px-3 text-[14px] font-medium text-tx2 transition-colors hover:bg-sf2 hover:text-tx",
        className,
      )}
    >
      <Smartphone className={look === "button" ? "size-4" : "size-5"} />
      {label}
    </a>
  );
}

/** Settings card with version, size and install notes. */
export function AndroidAppCard() {
  const { data } = useAndroidApp();
  if (!data) return null;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <IconTile tone="accent">
        <Smartphone />
      </IconTile>
      <div className="min-w-0 flex-1">
        <h2 className="text-title-card">InFrame for Android</h2>
        <p className="mt-0.5 text-body-s text-tx2">
          <span className="num">Version {data.version} · {formatBytes(data.size)}</span>. Take selfies with your camera, scan join QR
          codes and upload straight from your gallery. If Android asks, allow installing apps from your browser.
        </p>
      </div>
      <a
        href={data.url}
        download
        className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-ac px-5 text-[15px] font-semibold text-ac-tx transition-colors hover:bg-ac-hover"
      >
        <Download className="size-[18px]" /> Download APK
      </a>
    </Card>
  );
}
