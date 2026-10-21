import fs from "node:fs";
import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { AppError } from "./lib/errors.js";
import { modelReachable } from "./model/client.js";
import { StorageError } from "./storage/types.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { mediaRoutes } from "./routes/media.js";
import { meRoutes } from "./routes/me.js";
import { memberRoutes } from "./routes/members.js";
import { photoRoutes } from "./routes/photos.js";
import { storageRoutes } from "./routes/storage.js";
import { uploadRoutes } from "./routes/uploads.js";

/**
 * The HTTP API with every route registered, not yet listening. `index.ts`
 * adds migrations, the job queue and Socket.IO and starts it; tests drive it
 * directly.
 */
export async function buildApp(opts: { logger?: FastifyServerOptions["logger"] } = {}) {
  // HTTPS straight from Node when a certificate is configured: sign-in and
  // the Secure session cookies need it, and nothing sits in front of us.
  const tls =
    config.SSL_CERT_PATH && config.SSL_KEY_PATH
      ? { https: { cert: fs.readFileSync(config.SSL_CERT_PATH), key: fs.readFileSync(config.SSL_KEY_PATH) } }
      : {};
  const app = Fastify({
    ...tls,
    logger: opts.logger ?? {
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

  return app;
}
