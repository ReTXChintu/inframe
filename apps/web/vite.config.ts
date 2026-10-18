import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = process.env.INFRAME_API ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    // Same-origin in dev: cookies, signed media URLs and websockets all just work.
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/media": { target: api, changeOrigin: false },
      "/socket.io": { target: api, ws: true, changeOrigin: false },
    },
  },
});
