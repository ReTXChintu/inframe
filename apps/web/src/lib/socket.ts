import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { getToken, refreshToken } from "./api";

let socket: Socket | null = null;
const watched = new Map<string, number>();

/** One shared connection for the signed-in user; authenticates with the current access token. */
export function connectSocket() {
  if (socket) return socket;
  socket = io({
    path: "/socket.io",
    transports: ["websocket"],
    auth: (cb) => cb({ token: getToken() }),
  });
  socket.on("connect_error", async (err) => {
    // Access tokens are short-lived: refresh, then let socket.io's reconnect retry.
    if (err.message === "unauthorized") await refreshToken();
  });
  socket.on("connect", () => {
    for (const id of watched.keys()) socket?.emit("event:watch", id);
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  watched.clear();
}

/** Subscribe to a server event while the component is mounted. */
export function useSocketEvent<T = any>(name: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = connectSocket();
    const fn = (payload: T) => ref.current(payload);
    s.on(name, fn);
    return () => {
      s.off(name, fn);
    };
  }, [name]);
}

/** Join an event's room (live photo/sync/member updates) while mounted. */
export function useWatchEvent(eventId: string | undefined) {
  useEffect(() => {
    if (!eventId) return;
    const s = connectSocket();
    watched.set(eventId, (watched.get(eventId) ?? 0) + 1);
    if (s.connected) s.emit("event:watch", eventId);
    return () => {
      const n = (watched.get(eventId) ?? 1) - 1;
      if (n <= 0) {
        watched.delete(eventId);
        s.emit("event:unwatch", eventId);
      } else watched.set(eventId, n);
    };
  }, [eventId]);
}
