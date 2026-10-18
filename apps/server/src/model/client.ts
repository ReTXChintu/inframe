import sharp from "sharp";
import { normalize } from "../lib/vector.js";
import { modelSettings } from "../services/settings.js";

export interface DetectedFace {
  /** L2-normalised. */
  embedding: number[];
  score: number | null;
}

export class ModelError extends Error {
  constructor(
    message: string,
    /** True when retrying later might work (timeouts, 5xx, connection refused). */
    public retryable: boolean,
  ) {
    super(message);
  }
}

const EXPECTED_DIMS = 512;

interface ModelConfig {
  url: string | null;
  apiKey: string | null;
  apiKeyHeader: string;
  timeoutMs: number;
}

function headers(m: ModelConfig): Record<string, string> {
  return m.apiKey ? { [m.apiKeyHeader]: m.apiKey } : {};
}

function requireUrl(m: ModelConfig): string {
  if (!m.url) throw new ModelError("The face model isn't set up yet. The admin can add its URL in Admin → Settings.", false);
  return m.url;
}

function detailOf(body: unknown): string | undefined {
  const detail = (body as any)?.detail ?? (body as any)?.message ?? (body as any)?.error;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join("; ");
  return undefined;
}

/**
 * Sends one image to the external model's `POST /extract` and returns every
 * face it found. Accepts both `{faces: {face1: {...}}}` and `{faces: [...]}`,
 * with the vector under `descriptor`, `embedding` or `normed_embedding`.
 */
export async function extractFaces(jpeg: Buffer, m: ModelConfig = modelSettings()): Promise<DetectedFace[]> {
  const base = requireUrl(m);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "photo.jpg");

  let res: Response;
  try {
    res = await fetch(new URL("/extract", base), {
      method: "POST",
      body: form,
      headers: headers(m),
      signal: AbortSignal.timeout(m.timeoutMs),
    });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message;
    throw new ModelError(`Face model unreachable at ${base} (${reason}).`, true);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = detailOf(body) ?? res.statusText;
    // 4xx = the model rejected this image; trying again won't change that.
    throw new ModelError(`Face model returned ${res.status}: ${detail}`, res.status >= 500 || res.status === 429);
  }

  const raw = (body as any)?.faces;
  if (raw === undefined) throw new ModelError('Face model answered, but without a "faces" field — is this the right URL?', false);
  const list: any[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const faces: DetectedFace[] = [];
  for (const face of list) {
    const vec = face?.descriptor ?? face?.embedding ?? face?.normed_embedding;
    if (!Array.isArray(vec) || vec.length === 0) continue;
    if (vec.length !== EXPECTED_DIMS) {
      throw new ModelError(`Face model returned ${vec.length}-d embeddings; InFrame stores ${EXPECTED_DIMS}-d.`, false);
    }
    const score = face?.det_score ?? face?.score;
    faces.push({ embedding: normalize(vec.map(Number)), score: typeof score === "number" ? score : null });
  }
  return faces;
}

/** Cheap reachability probe for the health endpoint. Any HTTP answer counts as up. */
export async function modelReachable(): Promise<boolean> {
  const m = modelSettings();
  if (!m.url) return false;
  try {
    await fetch(m.url, { headers: headers(m), signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Admin "Test connection": sends a small blank image to /extract (with
 * unsaved settings if given) and checks the answer has InFrame's expected shape.
 */
export async function testModel(m: ModelConfig): Promise<{ ok: true; ms: number; faces: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const blank = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const faces = await extractFaces(blank, { ...m, timeoutMs: Math.min(m.timeoutMs, 30_000) });
    return { ok: true, ms: Date.now() - started, faces: faces.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
