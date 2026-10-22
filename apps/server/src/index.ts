import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { boss, startQueue } from "./jobs/queue.js";
import { startWorkers } from "./jobs/workers.js";
import { attachRealtime, closeRealtime } from "./realtime/io.js";
import { loadSettings } from "./services/settings.js";
import { ensureSpool } from "./lib/spool.js";
import { startPhotoPushLoop, stopPhotoPushLoop } from "./services/push.js";

const app = await buildApp();

await migrate((msg) => app.log.info(msg));
await loadSettings();
await ensureSpool();
await startQueue();
attachRealtime(app.server);
// Normally the workers are their own processes (`npm run worker`, pm2 "inframe-worker").
if (config.runWorkersInApi) {
  const queues = await startWorkers();
  app.log.info(`workers running inside the API process (${queues.join(", ")})`);
}
if (!config.oidc.issuer) {
  app.log.warn("OIDC_ISSUER is not set: nobody can sign in until the identity server is configured.");
} else if (!config.oidc.clientSecret) {
  app.log.warn("OIDC_CLIENT_SECRET is not set: web sign-in will be refused by the identity server.");
}
if (config.isProd && !config.httpsApp) {
  app.log.warn("APP_URL is not https: the sign-in and session cookies can't be marked Secure.");
}
await app.listen({ port: config.PORT, host: "0.0.0.0" });
// New-photo notifications, sent in batches (the workers only count them).
startPhotoPushLoop(app.log);
app.log.info(`InFrame API on :${config.PORT} — open ${config.appUrl}`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal}: shutting down`);
  stopPhotoPushLoop();
  await closeRealtime();
  await app.close();
  await boss.stop({ graceful: true, timeout: 20_000 }).catch(() => {});
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// A dropped database connection inside the job queue (pg-boss) surfaces as a
// stray rejection; log it rather than take the whole API down with it.
process.on("unhandledRejection", (err) => app.log.error({ err }, "unhandled rejection"));
