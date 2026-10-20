import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import heicConvert from "heic-convert";
import exifReader from "exif-reader";

/*
 * All image work happens in memory: originals come from (and derivatives go
 * back to) the event's Drive/MEGA folder. Only uploads waiting for a worker
 * (and videos being read by ffmpeg) touch the disk, in the spool (lib/spool.ts).
 */

sharp.cache(false);

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp|dng)$/i;
export const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|qt|webm|mkv|avi|3gp|3g2|mts|m2ts|mpe?g|wmv)$/i;

export function looksLikeImage(name: string, mime?: string | null): boolean {
  return Boolean(mime?.startsWith("image/")) || IMAGE_EXTENSIONS.test(name);
}

export function looksLikeVideo(name: string, mime?: string | null): boolean {
  return Boolean(mime?.startsWith("video/")) || VIDEO_EXTENSIONS.test(name);
}

/** "image", "video", or null for anything InFrame doesn't keep. */
export function mediaTypeOf(name: string, mime?: string | null): "image" | "video" | null {
  if (looksLikeVideo(name, mime)) return "video";
  if (looksLikeImage(name, mime)) return "image";
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", "3gp": "video/3gpp", "3g2": "video/3gpp2",
  mts: "video/mp2t", m2ts: "video/mp2t", mpg: "video/mpeg", mpeg: "video/mpeg", wmv: "video/x-ms-wmv",
};

/** Best content type for a file: the declared one unless it's missing or generic. */
export function mimeFor(name: string, declared?: string | null): string {
  if (declared && declared !== "application/octet-stream") return declared;
  return MIME_BY_EXT[name.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
}

export interface VideoInfo {
  /** PNG of a frame ~1s in (or the first frame for very short clips); null if none could be read. */
  poster: Buffer | null;
  durationMs: number | null;
}

/**
 * Poster frame + duration of a video file on disk, with the bundled ffmpeg.
 * Never throws: a video that can't be read is still stored, just without a poster.
 */
export async function videoInfo(file: string): Promise<VideoInfo> {
  if (!ffmpegPath) return { poster: null, durationMs: null };
  const run = (seek: string) =>
    new Promise<{ out: Buffer; err: string }>((resolve) => {
      const proc = spawn(
        ffmpegPath!,
        ["-hide_banner", "-ss", seek, "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const out: Buffer[] = [];
      let err = "";
      const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
      proc.stdout.on("data", (d: Buffer) => out.push(d));
      proc.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-20_000)));
      proc.on("close", () => {
        clearTimeout(timer);
        resolve({ out: Buffer.concat(out), err });
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve({ out: Buffer.alloc(0), err: "" });
      });
    });
  let { out, err } = await run("1");
  if (out.length === 0) ({ out, err } = await run("0")); // clip shorter than a second
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const durationMs = d ? Math.round(((Number(d[1]) * 60 + Number(d[2])) * 60 + Number(d[3])) * 1000) : null;
  return { poster: out.length ? out : null, durationMs };
}

export function isHeic(buf: Buffer, name?: string, mime?: string | null): boolean {
  if (mime && /hei[cf]/i.test(mime)) return true;
  if (name && /\.hei[cf]$/i.test(name)) return true;
  // ISO-BMFF "ftyp" box with a HEIF brand.
  const brand = buf.subarray(8, 12).toString("ascii");
  return buf.subarray(4, 8).toString("ascii") === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand);
}

/** sharp's prebuilt libvips can't decode HEVC-coded HEIC, so convert those up front. */
export async function decodable(buf: Buffer, name?: string, mime?: string | null): Promise<Buffer> {
  if (!isHeic(buf, name, mime)) return buf;
  const out = await heicConvert({ buffer: new Uint8Array(buf), format: "JPEG", quality: 0.92 });
  return Buffer.from(out as unknown as ArrayBuffer);
}

export interface Derivatives {
  /** 480×480 cover crop for the grid. */
  thumb: Buffer;
  /** Long edge ≤ 2000px, for the full-screen viewer and face detection. */
  preview: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
}

export async function makeDerivatives(input: Buffer): Promise<Derivatives> {
  const meta = await sharp(input).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;

  const base = sharp(input, { failOn: "none" }).rotate();
  const [thumb, preview] = await Promise.all([
    base.clone().resize({ width: 480, height: 480, fit: "cover", position: "attention" }).webp({ quality: 72 }).toBuffer(),
    base.clone().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
  ]);
  return { thumb, preview, width, height, takenAt: readTakenAt(meta.exif) };
}

function readTakenAt(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  try {
    const data = exifReader(exif) as any;
    const value = data?.Photo?.DateTimeOriginal ?? data?.Image?.DateTime;
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) && date.getFullYear() > 1990 ? date : null;
  } catch {
    return null;
  }
}

/** What we send the face model: upright JPEG, long edge ≤ 1920px. */
export async function forModel(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** 512×512 WebP kept in the database as the person's avatar (~20–40 KB). */
export async function makeSelfie(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 512, height: 512, fit: "cover", position: "attention" })
    .webp({ quality: 80 })
    .toBuffer();
}
