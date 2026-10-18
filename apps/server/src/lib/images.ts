import sharp from "sharp";
import heicConvert from "heic-convert";
import exifReader from "exif-reader";

/*
 * All image work happens in memory: originals come from (and derivatives go
 * back to) the event's Drive/MEGA folder. Nothing is written to local disk.
 */

sharp.cache(false);

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp)$/i;

export function looksLikeImage(name: string, mime?: string | null): boolean {
  return Boolean(mime?.startsWith("image/")) || IMAGE_EXTENSIONS.test(name);
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
