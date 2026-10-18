import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { userFromToken } from "../auth/guard.js";
import { eventAccess } from "../services/access.js";

let io: Server | null = null;

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

  return io;
}

export function toUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function toEvent(eventId: string, event: string, payload: unknown) {
  io?.to(`event:${eventId}`).emit(event, payload);
}

/** Drop a user's sockets from an event room (after they leave or are removed). */
export function evictFromEvent(userId: string, eventId: string) {
  io?.in(`user:${userId}`).socketsLeave(`event:${eventId}`);
}

export function closeRealtime() {
  return new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
