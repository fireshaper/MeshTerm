import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DEFAULT_THEME_ID,
  THEME_FILE_TYPES,
  ThemeId,
  ThemeManifest,
  ThemeMapStyle,
  themeFileType,
  type ThemeDTO,
  type ThemeSource,
} from "@meshterm/shared";
import { silentLogger, type Logger } from "../logger.js";

/** Limits that keep a scan cheap even if someone drops a huge folder in. */
const MAX_FILES = 300;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_DEPTH = 4;

/** One theme folder as scanned. */
export interface ThemeEntry {
  /** The folder name. */
  id: string;
  source: "builtin" | "user";
  dir: string;
  hash: string;
  manifest: ThemeManifest | null;
  error: string | null;
  warnings: string[];
}

export interface ThemeRegistryOptions {
  /** Built-in themes (the repo's themes/); null for none. */
  builtinDir: string | null;
  /** User themes (/data/themes); null for none. */
  userDir: string | null;
  /** MeshTerm's version, for `minAppVersion`; unset skips the check. */
  appVersion?: string;
  logger?: Logger;
}

/**
 * Every theme from the built-in and user folders (CR-004 §4.1–4.3). A valid user theme
 * with a built-in's id overrides it; a broken one doesn't, so a bad edit can't take a
 * built-in away.
 */
export class ThemeRegistry {
  private readonly builtin = new Map<string, ThemeEntry>();
  private readonly user = new Map<string, ThemeEntry>();
  private readonly logger: Logger;

  constructor(private readonly options: ThemeRegistryOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  get userDir(): string | null {
    return this.options.userDir;
  }

  /** Scans both folders from scratch. */
  scanAll(): void {
    this.builtin.clear();
    this.user.clear();
    for (const [source, dir, map] of [
      ["builtin", this.options.builtinDir, this.builtin],
      ["user", this.options.userDir, this.user],
    ] as const) {
      if (!dir || !existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const entry = this.scanFolder(source, dir, name);
        if (entry) map.set(name, entry);
      }
    }
    for (const id of this.user.keys()) {
      if (this.builtin.has(id) && this.user.get(id)?.manifest) {
        this.logger.warn({ id }, "user theme overrides the built-in one");
      }
    }
  }

  /**
   * Rescans one user folder (after a file change); returns the theme as now resolved
   * for that id, or null when no theme has it any more.
   */
  rescanUser(id: string): ThemeEntry | null {
    const dir = this.options.userDir;
    if (!dir) return null;
    const entry = this.scanFolder("user", dir, id);
    if (entry) this.user.set(id, entry);
    else this.user.delete(id);
    return this.resolve(id);
  }

  /** The theme served for an id: a valid user theme, else the built-in, else a broken user one. */
  resolve(id: string): ThemeEntry | null {
    const user = this.user.get(id);
    const builtin = this.builtin.get(id);
    if (user?.manifest) return user;
    return builtin ?? user ?? null;
  }

  /** A valid theme by id (what may be served or chosen). */
  get(id: string): ThemeEntry | null {
    const entry = this.resolve(id);
    return entry?.manifest ? entry : null;
  }

  /** Every theme id, sorted with Default first. */
  ids(): string[] {
    const ids = new Set([...this.builtin.keys(), ...this.user.keys()]);
    return [...ids].sort((a, b) =>
      a === DEFAULT_THEME_ID ? -1 : b === DEFAULT_THEME_ID ? 1 : a.localeCompare(b),
    );
  }

  /** The list for `GET /api/themes`: broken themes and problems only for admins. */
  list(admin: boolean): ThemeDTO[] {
    const out: ThemeDTO[] = [];
    for (const id of this.ids()) {
      const entry = this.resolve(id);
      if (!entry) continue;
      if (!entry.manifest && !admin) continue;
      const brokenOverride =
        entry.source === "builtin" && this.user.has(id) ? this.user.get(id) : undefined;
      const warnings = [
        ...entry.warnings,
        ...(brokenOverride?.error
          ? [`The user copy in /data/themes is broken: ${brokenOverride.error}`]
          : []),
      ];
      out.push({
        id,
        source: this.sourceOf(entry),
        hash: entry.hash,
        valid: entry.manifest !== null,
        manifest: entry.manifest,
        ...(admin && entry.error ? { error: entry.error } : {}),
        ...(admin && warnings.length > 0 ? { warnings } : {}),
      });
    }
    return out;
  }

  sourceOf(entry: ThemeEntry): ThemeSource {
    if (entry.source === "builtin") return "builtin";
    return this.builtin.has(entry.id) ? "override" : "user";
  }

  private scanFolder(source: "builtin" | "user", root: string, name: string): ThemeEntry | null {
    const dir = join(root, name);
    let stat;
    try {
      stat = lstatSync(dir);
    } catch {
      return null;
    }
    if (!stat.isDirectory() || name.startsWith(".")) return null;
    const entry: ThemeEntry = {
      id: name,
      source,
      dir,
      hash: "",
      manifest: null,
      error: null,
      warnings: [],
    };
    try {
      const files = listThemeFiles(dir);
      entry.hash = hashFiles(dir, files);
      entry.manifest = this.readManifest(dir, name, files, entry.warnings);
      for (const file of files.filter((f) => f.endsWith(".css"))) {
        if (/url\(\s*['"]?\s*(?!data:)(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(readText(dir, file))) {
          entry.warnings.push(
            `${file} loads something from outside MeshTerm; browsers will block it`,
          );
        }
      }
    } catch (err) {
      entry.manifest = null;
      entry.error = err instanceof Error ? err.message : String(err);
      this.logger.error({ theme: name, source, error: entry.error }, "theme skipped");
    }
    for (const warning of entry.warnings)
      this.logger.warn({ theme: name, source, warning }, "theme warning");
    return entry;
  }

  private readManifest(
    dir: string,
    name: string,
    files: readonly string[],
    warnings: string[],
  ): ThemeManifest {
    if (!ThemeId.safeParse(name).success) {
      throw new Error(`the folder name "${name}" isn't a valid theme id (a-z, 0-9 and -)`);
    }
    if (!files.includes("theme.json")) throw new Error("no theme.json");
    let json: unknown;
    try {
      json = JSON.parse(readText(dir, "theme.json"));
    } catch {
      throw new Error("theme.json isn't valid JSON");
    }
    const parsed = ThemeManifest.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `theme.json: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`,
      );
    }
    const manifest = parsed.data;
    if (manifest.id !== name) {
      throw new Error(`theme.json id "${manifest.id}" doesn't match the folder name "${name}"`);
    }
    const referenced = [
      manifest.entry,
      manifest.modes?.light,
      manifest.modes?.dark,
      manifest.mapStyle,
      ...(manifest.fonts ?? []).map((f) => f.src),
      ...Object.values(manifest.sounds ?? {}),
    ].filter((p): p is string => p !== undefined);
    for (const path of referenced) {
      if (!files.includes(path))
        throw new Error(`theme.json names ${path}, which isn't in the folder`);
    }
    if (manifest.mapStyle) warnings.push(...checkMapStyle(dir, manifest.mapStyle));
    const app = this.options.appVersion;
    if (app && manifest.minAppVersion && compareVersions(app, manifest.minAppVersion) < 0) {
      warnings.push(`made for MeshTerm ${manifest.minAppVersion} or later (this is ${app})`);
    }
    return manifest;
  }
}

/**
 * The served files of a theme folder, as `/`-separated relative paths, sorted. Symlinks
 * and dot-files are left out, so nothing outside the folder can be reached through it.
 */
export function listThemeFiles(dir: string): string[] {
  const out: string[] = [];
  let bytes = 0;
  const walk = (folder: string, depth: number) => {
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(folder, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1);
        continue;
      }
      const type = themeFileType(name);
      if (!stat.isFile() || type === null || !(type in THEME_FILE_TYPES)) continue;
      bytes += stat.size;
      out.push(relative(dir, full).split(sep).join("/"));
      if (out.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files`);
      if (bytes > MAX_BYTES) throw new Error(`more than ${MAX_BYTES / 1024 / 1024} MB`);
    }
  };
  walk(dir, 0);
  return out;
}

/** 12 hex characters over every served file's path and content. */
function hashFiles(dir: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(join(dir, file)))
      .update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

const readText = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

/**
 * Validates a theme's map style (CR-004 §8.3); throws when it's unusable, returns
 * warnings for parts MeshTerm ignores.
 */
function checkMapStyle(dir: string, file: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(readText(dir, file));
  } catch {
    throw new Error(`${file} isn't valid JSON`);
  }
  const parsed = ThemeMapStyle.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${file}: ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`,
    );
  }
  const warnings: string[] = [];
  const sources = Object.values(parsed.data.sources ?? {});
  if (sources.some((src) => "tiles" in src || "url" in src)) {
    warnings.push(`${file}: tile URLs are ignored; map tiles always come through MeshTerm`);
  }
  if (parsed.data.layers.some((l) => l.type !== "background" && l.type !== "raster")) {
    warnings.push(`${file}: vector layers aren't drawn yet (only background and raster)`);
  }
  return warnings;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The absolute path of a file a theme may serve, or null: an allowlisted type, inside
 * the folder after resolving links, and not a dot-file.
 */
export function themeFilePath(entry: ThemeEntry, file: string): string | null {
  const segments = file.split("/");
  if (
    file.includes("\\") ||
    file.includes("\0") ||
    segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))
  ) {
    return null;
  }
  const type = themeFileType(file);
  if (type === null || !(type in THEME_FILE_TYPES)) return null;
  const full = join(entry.dir, ...segments);
  try {
    const real = realpathSync(full);
    const root = realpathSync(entry.dir);
    if (!real.startsWith(root + sep)) return null;
    if (!statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}
