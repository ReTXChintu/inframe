import type { Server as HttpServer } from "node:http";
import pg from "pg";
import { Server } from "socket.io";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { userFromToken } from "../auth/guard.js";
import { eventAccess } from "../services/access.js";

/*
 * Socket.IO lives in the API process. Worker processes (storing uploads,
 * thumbnails, face scans) have no sockets: they publish with Postgres
 * NOTIFY on CHANNEL, and the API process LISTENs and forwards to the room.
 * No Redis needed — the database the workers already use carries it.
 */

const CHANNEL = "inframe_realtime";
let io: Server | null = null;
let listener: pg.Client | null = null;
let stopping = false;

/**
 * Socket.IO on the API's own HTTP server. The handshake must carry an access
 * token; each socket joins `user:<id>` and, on request, `event:<id>` rooms for
 * events the user belongs to.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, { path: "/socket.io", serveClient: false });

  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth?.token as string | undefined);
    if (!user) return next(new Error("unauthorized"));
    socket.data.userId = user.id;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);

    socket.on("event:watch", async (eventId: unknown, ack?: (ok: boolean) => void) => {
      const id = z.string().uuid().safeParse(eventId);
      if (!id.success) return ack?.(false);
      try {
        await eventAccess(id.data, userId);
        socket.join(`event:${id.data}`);
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });

    socket.on("event:unwatch", (eventId: unknown) => {
      if (typeof eventId === "string") socket.leave(`event:${eventId}`);
    });
  });

  void listen();
  return io;
}

/** API process: receive events published by worker processes. Reconnects if the connection drops. */
async function listen() {
  if (stopping) return;
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  listener = client;
  const retry = () => {
    if (listener === client) listener = null;
    client.end().catch(() => {});
    if (!stopping) setTimeout(() => void listen(), 3000);
  };
  client.on("error", retry);
  client.on("end", () => listener === client && retry());
  client.on("notification", (msg) => {
    if (!msg.payload || !io) return;
    try {
      const { room, event, payload } = JSON.parse(msg.payload) as { room: string; event: string; payload: unknown };
      io.to(room).emit(event, payload);
    } catch {
      // malformed message — ignore
    }
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    console.error("[realtime] listener failed:", (err as Error).message);
    retry();
  }
}

function emit(room: string, event: string, payload: unknown) {
  if (io) {
    io.to(room).emit(event, payload);
    return;
  }
  // Worker process: hand it to the API process through Postgres (payload limit ~8 KB).
  const message = JSON.stringify({ room, event, payload });
  if (message.length > 7900) return;
  pool.query("SELECT pg_notify($1, $2)", [CHANNEL, message]).catch(() => {});
}

export function toUser(userId: string, event: string, payload: unknown) {
  emit(`user:${userId}`, event, payload);
}

export function toEvent(eventId: string, event: string, payload: unknown) {
  emit(`event:${eventId}`, event, payload);
}

/** Drop a user's sockets from an event room (after they leave or are removed). API process only. */
export function evictFromEvent(userId: string, eventId: string) {
  io?.in(`user:${userId}`).socketsLeave(`event:${eventId}`);
}

export async function closeRealtime() {
  stopping = true;
  await listener?.end().catch(() => {});
  await new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
