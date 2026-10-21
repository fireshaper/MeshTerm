import { defineConfig } from "tsup";

/**
 * Not bundled: better-sqlite3 is a native addon (shipped beside the bundle in the
 * Docker image); ws's optional native speedups are loaded in try/catch only.
 */
const EXTERNAL = ["better-sqlite3", "bufferutil", "utf-8-validate"];

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  // One file: the Docker image (and any deploy) only has to carry main.js. A dynamic
  // import() in a dependency would otherwise become a separate chunk.
  splitting: false,
  sourcemap: true,
  // Everything else is bundled (workspace packages are TypeScript source, and this
  // keeps the runtime image to node + one native module), then tree-shaken.
  // (noExternal wins over external in tsup, so the pattern must skip EXTERNAL itself.)
  noExternal: [new RegExp(`^(?!(${EXTERNAL.join("|")})(/|$))`)],
  external: EXTERNAL,
  // Some bundled dependencies are CommonJS and call require() for Node builtins.
  banner: {
    js: 'import { createRequire as __mtCreateRequire } from "node:module"; const require = __mtCreateRequire(import.meta.url);',
  },
});
