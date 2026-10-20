/*
 * InFrame worker process: stores uploads in Drive/MEGA, makes thumbnails and
 * video posters, runs face detection + matching, and syncs storage folders.
 *
 *   npm run worker                      (all queues)
 *   WORKER_QUEUES=faces npm run worker  (just face detection, e.g. on a second process)
 *
 * Run as many as you like (pm2 "inframe-worker" instances): they share the
 * pg-boss queues in Postgres, so each job runs once. They must run on the
 * same machine as the API, because uploads wait for them in SPOOL_DIR.
 * Progress reaches browsers through the API process (Postgres NOTIFY).
 */
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { boss, startQueue } from "./jobs/queue.js";
import { startWorkers } from "./jobs/workers.js";
import { ensureSpool } from "./lib/spool.js";
import { loadSettings } from "./services/settings.js";

if (config.devMemoryStorage) {
  console.error(
    "[worker] DEV_MEMORY_STORAGE keeps files in the API process's memory, so the API runs the workers itself. Not starting.",
  );
  process.exit(0);
}

await migrate((msg) => console.log(msg));
await loadSettings();
await ensureSpool();
await startQueue();
const queues = await startWorkers();
console.log(`[worker ${process.pid}] serving ${queues.join(", ")} × ${config.WORKER_CONCURRENCY}`);

// Admin changes (face model URL, threshold…) are saved by the API process;
// pick them up here too.
const refresh = setInterval(() => void loadSettings().catch(() => {}), 30_000);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker ${process.pid}] ${signal}: finishing current jobs…`);
  clearInterval(refresh);
  await boss.stop({ graceful: true, timeout: 60_000 }).catch(() => {});
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// A dropped database connection inside pg-boss surfaces as a stray rejection;
// log it and keep serving (the job is retried by the queue).
process.on("unhandledRejection", (err) => console.error(`[worker ${process.pid}] unhandled rejection:`, err));
