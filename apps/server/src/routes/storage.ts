import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { googleSettings } from "../services/settings.js";
import { requireUser } from "../auth/guard.js";
import { signState, verifyState } from "../auth/tokens.js";
import { one, query } from "../db/pool.js";
import { encryptJson } from "../lib/crypto.js";
import { AppError, badRequest, forbidden, notFound, parse } from "../lib/errors.js";
import { GOOGLE_SCOPES, GoogleDriveProvider, oauthClient } from "../storage/gdrive.js";
import { forgetMegaSession, verifyMegaLogin } from "../storage/mega.js";
import { loadConnection, providerFor, StorageError, type ConnectionRow } from "../storage/index.js";
import { email, parseId } from "./shared.js";

export function serializeConnection(c: ConnectionRow & { created_at: Date; event_count?: number }) {
  return {
    id: c.id,
    provider: c.provider,
    accountLabel: c.account_label,
    status: c.status,
    lastError: c.last_error,
    createdAt: c.created_at,
    eventCount: c.event_count ?? 0,
  };
}

/** A connection the caller owns, or 404. */
export async function ownConnection(connectionId: string, userId: string) {
  const conn = await loadConnection(connectionId);
  if (conn.user_id !== userId) throw notFound("Storage connection");
  return conn;
}

/** Turn provider failures into 400s with the provider's own explanation. */
export function storageFailure(err: unknown): never {
  if (err instanceof StorageError) throw new AppError(400, "storage", err.message);
  throw err;
}

/** Safe in-app path to send the browser back to after OAuth. */
const safeReturn = (value: unknown) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/settings";

export async function storageRoutes(app: FastifyInstance) {
  // Google redirects the browser here, so it can't carry our bearer token —
  // the signed `state` says who started the flow.
  app.get("/api/storage/google/callback", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const state = q.state ? await verifyState<{ uid: string; ret: string }>(q.state) : null;
    const back = (status: string) =>
      reply.redirect(`${config.appUrl}${safeReturn(state?.ret)}${safeReturn(state?.ret).includes("?") ? "&" : "?"}storage=${status}`);
    if (!state) return reply.redirect(`${config.appUrl}/settings?storage=expired`);
    if (q.error || !q.code) return back("cancelled");

    try {
      const client = oauthClient();
      const { tokens } = await client.getToken(q.code);
      if (!tokens.refresh_token) return back("no-refresh-token");
      const accountEmail = await new GoogleDriveProvider(tokens.refresh_token).accountEmail();
      const secret = encryptJson({ refreshToken: tokens.refresh_token });
      // Reconnecting the same Google account refreshes its token instead of adding a duplicate.
      const existing = await one<{ id: string }>(
        "SELECT id FROM storage_connections WHERE user_id = $1 AND provider = 'gdrive' AND account_label = $2",
        [state.uid, accountEmail],
      );
      if (existing) {
        await query(
          "UPDATE storage_connections SET secret = $2, status = 'ok', last_error = NULL, updated_at = now() WHERE id = $1",
          [existing.id, secret],
        );
      } else {
        await query(
          "INSERT INTO storage_connections (user_id, provider, account_label, secret) VALUES ($1, 'gdrive', $2, $3)",
          [state.uid, accountEmail, secret],
        );
      }
      return back("connected");
    } catch (err) {
      req.log.warn({ err }, "google oauth callback failed");
      return back("failed");
    }
  });

  app.register(async (authed) => {
    authed.addHook("preHandler", requireUser);

    authed.get("/api/storage/connections", async (req) => {
      const rows = await query<ConnectionRow & { created_at: Date; event_count: number }>(
        `SELECT c.*, (SELECT count(*)::int FROM events e WHERE e.storage_connection_id = c.id) AS event_count
           FROM storage_connections c WHERE c.user_id = $1 ORDER BY c.created_at`,
        [req.user.id],
      );
      return {
        connections: rows.map(serializeConnection),
        googleEnabled: googleSettings().enabled,
        devMemoryStorage: config.devMemoryStorage,
      };
    });

    /** Development only (DEV_MEMORY_STORAGE=true): a throwaway in-memory storage account. */
    authed.post("/api/storage/dev-memory", async (req, reply) => {
      if (!config.devMemoryStorage) throw notFound("Route");
      const existing = await one("SELECT * FROM storage_connections WHERE user_id = $1 AND provider = 'memory'", [req.user.id]);
      if (existing) return { connection: serializeConnection(existing) };
      const conn = await one(
        `INSERT INTO storage_connections (user_id, provider, account_label, secret)
         VALUES ($1, 'memory', 'Dev memory storage (lost on restart)', $2) RETURNING *`,
        [req.user.id, encryptJson({})],
      );
      reply.code(201);
      return { connection: serializeConnection(conn) };
    });

    authed.post("/api/storage/google/start", async (req) => {
      const body = parse(z.object({ returnTo: z.string().max(300).optional() }), req.body ?? {});
      if (!googleSettings().enabled) throw badRequest("Google Drive isn't set up yet. The admin can add it in Admin → Settings.");
      const state = await signState({ uid: req.user.id, ret: safeReturn(body.returnTo) });
      const url = oauthClient().generateAuthUrl({
        access_type: "offline",
        // Always ask, so Google always returns a refresh token.
        prompt: "consent",
        scope: GOOGLE_SCOPES,
        state,
      });
      return { url };
    });

    authed.post("/api/storage/mega", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
      const body = parse(z.object({ email, password: z.string().min(1, "Enter your MEGA password.").max(200) }), req.body);
      try {
        await verifyMegaLogin(body);
      } catch (err) {
        storageFailure(err);
      }
      const secret = encryptJson({ email: body.email, password: body.password });
      const existing = await one<{ id: string }>(
        "SELECT id FROM storage_connections WHERE user_id = $1 AND provider = 'mega' AND account_label = $2",
        [req.user.id, body.email],
      );
      let id: string;
      if (existing) {
        id = existing.id;
        forgetMegaSession(id);
        await query(
          "UPDATE storage_connections SET secret = $2, status = 'ok', last_error = NULL, updated_at = now() WHERE id = $1",
          [id, secret],
        );
      } else {
        id = (await one<{ id: string }>(
          "INSERT INTO storage_connections (user_id, provider, account_label, secret) VALUES ($1, 'mega', $2, $3) RETURNING id",
          [req.user.id, body.email, secret],
        ))!.id;
        reply.code(201);
      }
      const conn = await one("SELECT * FROM storage_connections WHERE id = $1", [id]);
      return { connection: serializeConnection(conn) };
    });

    authed.delete("/api/storage/connections/:id", async (req) => {
      const conn = await ownConnection(parseId(req.params), req.user.id);
      if (conn.provider === "mega") forgetMegaSession(conn.id);
      // Events using it keep their photos in InFrame but stop syncing/accepting uploads.
      await query("DELETE FROM storage_connections WHERE id = $1", [conn.id]);
      return { ok: true };
    });

    /** Check a pasted folder link before it's saved on an event. */
    authed.post("/api/storage/connections/:id/resolve", async (req) => {
      const conn = await ownConnection(parseId(req.params), req.user.id);
      const body = parse(z.object({ folder: z.string().trim().min(1, "Paste a folder link.").max(500) }), req.body);
      try {
        return { folder: await providerFor(conn).resolveFolder(body.folder) };
      } catch (err) {
        storageFailure(err);
      }
    });
  });
}

/** Resolve or create the folder an event will use. Shared by create + change-storage. */
export async function pickFolder(
  conn: ConnectionRow,
  userId: string,
  choice: { folder?: string | null; createNamed?: string | null },
) {
  if (conn.user_id !== userId) throw forbidden("Use one of your own storage connections.");
  if (conn.status === "error") throw badRequest("That storage connection needs to be reconnected first.");
  const provider = providerFor(conn);
  try {
    if (choice.folder) return { folder: await provider.resolveFolder(choice.folder), created: false };
    return { folder: await provider.createFolder(choice.createNamed || "InFrame"), created: true };
  } catch (err) {
    storageFailure(err);
  }
}
