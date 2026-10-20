import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto.js";
import { config } from "../config.js";

/*
 * The spool is where an upload waits between "received from the phone or
 * browser" and "stored in Drive/MEGA" (a worker process does the second
 * part). It's the only place InFrame puts media on the server's disk, and
 * each file is deleted as soon as it's stored. The API and the workers must
 * share it, i.e. run on the same machine.
 */

export async function ensureSpool() {
  await fsp.mkdir(config.spoolDir, { recursive: true });
}

/** A fresh path inside the spool (the file isn't created). */
export function newSpoolPath(): string {
  return path.join(config.spoolDir, `${Date.now()}-${randomToken(9)}`);
}

export async function removeSpool(file: string | null | undefined) {
  if (file) await fsp.rm(file, { force: true }).catch(() => {});
}

export const spoolExists = (file: string | null | undefined): file is string => Boolean(file && fs.existsSync(file));
