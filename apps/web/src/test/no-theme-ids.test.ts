// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// CR-004 §6.3 and §13: themes restyle the app through tokens and hooks only, so no
// component (or its CSS) may name a particular theme.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const THEME_IDS = /retro-terminal|cyberpunk|neon-district/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

it("no app source or style names a specific theme", () => {
  const offenders = files(SRC)
    .filter((f) => THEME_IDS.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f));
  expect(offenders).toEqual([]);
});
