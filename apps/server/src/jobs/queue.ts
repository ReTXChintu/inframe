import PgBoss from "pg-boss";
import { config } from "../config.js";

/*
 * Background work runs on pg-boss: a job queue that lives in the same Neon
 * Postgres database (schema "pgboss"), so there's no Redis to run. Jobs are
 * retried with exponential backoff; the handlers are written to be safe to
 * re-run from the top.
 */

export const Q = {
  /** Make the thumbnail + preview and store them in the photo's ".inframe" folder. */
  ingest: "photo-ingest",
  /** Send the photo to the face model, store faces, compute matches. */
  faces: "photo-faces",
  /** Scan one event's storage folder for added/removed photos. */
  sync: "event-sync",
  /** Cron: queue a sync for every event that has storage connected. */
  syncAll: "event-sync-all",
} as const;

export interface IngestJob {
  photoId: string;
}
export interface FacesJob {
  photoId: string;
}
export interface SyncJob {
  eventId: string;
}

export const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  schema: "pgboss",
  max: 4,
  // Keep finished jobs around briefly for debugging, then let maintenance purge them.
  deleteAfterDays: 3,
});

boss.on("error", (err) => console.error("[jobs]", err.message));

const queues: PgBoss.Queue[] = [
  { name: Q.ingest, retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 15 * 60 },
  { name: Q.faces, retryLimit: 6, retryDelay: 20, retryBackoff: true, expireInSeconds: 10 * 60 },
  // "stately": at most one queued + one running sync per event (singletonKey = eventId).
  { name: Q.sync, policy: "stately", retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 60 * 60 },
  { name: Q.syncAll, policy: "singleton", retryLimit: 0 },
];

export async function startQueue() {
  await boss.start();
  for (const q of queues) {
    const existing = await boss.getQueue(q.name);
    if (existing) await boss.updateQueue(q.name, q);
    else await boss.createQueue(q.name, q);
  }
}

export const enqueueIngest = (job: IngestJob) => boss.send(Q.ingest, job);
export const enqueueFaces = (job: FacesJob) => boss.send(Q.faces, job);
export const enqueueSync = (eventId: string) => boss.send(Q.sync, { eventId } satisfies SyncJob, { singletonKey: eventId });

export async function enqueueIngestMany(jobs: IngestJob[]) {
  for (let i = 0; i < jobs.length; i += 500) {
    await boss.insert(jobs.slice(i, i + 500).map((data) => ({ name: Q.ingest, data })));
  }
}

export const isLastAttempt = (job: PgBoss.JobWithMetadata<unknown>) => job.retryCount >= job.retryLimit;
