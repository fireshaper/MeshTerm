import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Same root .env the server's dev script reads, so both agree on the port.
  const env = loadEnv(mode, "../..", "MESHTERM_");
  const server = `http://127.0.0.1:${env.MESHTERM_HTTP_PORT ?? "8080"}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": server,
        "/healthz": server,
        "/themes": server,
        "/ws": { target: server, ws: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      rollupOptions: {
        output: {
          // zod and zod-config.ts share a chunk, so the JIT is off before any other chunk
          // builds or parses a schema (the CSP has no 'unsafe-eval'). In the entry chunk,
          // zod-config would run after the shared chunks it imports. Vite ids use `/`.
          manualChunks: (id: string) =>
            /\/node_modules\/zod\/|\/src\/zod-config\.ts$/.test(id) ? "zod" : undefined,
        },
      },
    },
  };
});
