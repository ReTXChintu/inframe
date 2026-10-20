import fs from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { AppError } from "./lib/errors.js";
import { boss, startQueue } from "./jobs/queue.js";
import { startWorkers } from "./jobs/workers.js";
import { modelReachable } from "./model/client.js";
import { attachRealtime, closeRealtime } from "./realtime/io.js";
import { StorageError } from "./storage/types.js";
import { loadSettings } from "./services/settings.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { mediaRoutes } from "./routes/media.js";
import { meRoutes } from "./routes/me.js";
import { memberRoutes } from "./routes/members.js";
import { photoRoutes } from "./routes/photos.js";
import { storageRoutes } from "./routes/storage.js";
import { uploadRoutes } from "./routes/uploads.js";
import { ensureSpool } from "./lib/spool.js";

const app = Fastify({
  logger: {
    level: config.isProd ? "info" : "debug",
    transport: undefined,
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  trustProxy: true,
  bodyLimit: 1024 * 1024,
});

await app.register(cookie);
// Uploads are streamed to disk (never buffered whole), so the cap is the video limit.
await app.register(multipart, {
  limits: { fileSize: Math.max(config.maxUploadBytes, config.maxVideoBytes), files: 1, fields: 10 },
});
// Global off; individual routes opt in with `config.rateLimit`.
await app.register(rateLimit, { global: false });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.status).send({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err instanceof StorageError) {
    return reply.code(502).send({ code: "storage", message: err.message });
  }
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) {
    // Fastify/plugin errors (bad JSON, rate limit, too large…)
    const message = status === 429 ? "Too many attempts. Wait a minute and try again." : (err as Error).message;
    return reply.code(status).send({ code: (err as { code?: string }).code ?? "error", message });
  }
  req.log.error(err);
  return reply.code(500).send({ code: "internal", message: "Something went wrong on our side." });
});

app.get("/api/health", async () => {
  const [db, model] = await Promise.all([
    pool.query("SELECT 1").then(() => true, () => false),
    modelReachable(),
  ]);
  return { ok: db, db, model };
});

await app.register(authRoutes);
await app.register(meRoutes);
await app.register(storageRoutes);
await app.register(eventRoutes);
await app.register(memberRoutes);
await app.register(photoRoutes);
await app.register(uploadRoutes);
await app.register(mediaRoutes);
await app.register(adminRoutes);

// Production: serve the built web app, with SPA fallback for client routes.
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    // Client-side routes get the app; a missing *file* (e.g. /inframe.apk before the
    // first Android release) is a real 404, not an HTML page.
    if (req.method === "GET" && !/^\/(api|media|socket\.io)\//.test(path) && !/\.[a-z0-9]{2,5}$/i.test(path)) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ code: "not_found", message: "Not found." });
  });
}

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
await app.listen({ port: config.PORT, host: "0.0.0.0" });
app.log.info(`InFrame API on :${config.PORT} — open ${config.appUrl}`);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal}: shutting down`);
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
