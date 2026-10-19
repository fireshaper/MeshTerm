import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages export TypeScript source, so they must be bundled in.
  // Everything else in package.json dependencies stays external (better-sqlite3 is native).
  noExternal: [/^@meshterm\//],
});
