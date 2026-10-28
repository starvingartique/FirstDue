import { defineConfig } from "vite";

// Dev proxy keeps client calls same-origin. The Hono server owns the Meta key.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
