import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_THEME_ID,
  DuplicateThemeBody,
  THEME_FILE_TYPES,
  ThemeDTO,
  ThemeId,
  ThemesDTO,
  themeFileType,
  type ThemeFileType,
} from "@meshterm/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { auditRequest } from "../auth/plugin.js";
import type { Db } from "../db/database.js";
import { settings } from "../db/schema.js";
import { listThemeFiles, themeFilePath, type ThemeRegistry } from "../themes/registry.js";
import type { ThemeWatcher } from "../themes/watcher.js";
import { HttpError } from "./http-error.js";
import { IMMUTABLE, NO_CACHE } from "./static.js";

export const DEFAULT_THEME_SETTING = "theme.default";

/** The server-wide default (CR-004 §4.3): the stored id while it's a valid theme, else Default. */
export function getDefaultTheme(db: Db, registry: ThemeRegistry): string {
  const row = db.select().from(settings).where(eq(settings.key, DEFAULT_THEME_SETTING)).get();
  let id: unknown = null;
  try {
    id = row ? JSON.parse(row.value) : null;
  } catch {
    // A broken setting falls back.
  }
  return typeof id === "string" && registry.get(id) ? id : DEFAULT_THEME_ID;
}

function setDefaultTheme(db: Db, id: string, now: number): void {
  const value = JSON.stringify(id);
  db.insert(settings)
    .values({ key: DEFAULT_THEME_SETTING, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}

/**
 * Themes (CR-004 Phase A): the list and the server default (readable before sign-in,
 * since the sign-in page is themed too), Duplicate, and the theme files themselves.
 */
export function themeRoutes(registry: ThemeRegistry, watcher: ThemeWatcher): FastifyPluginAsyncZod {
  return (app) => {
    const { db, clock } = app.meshterm;

    app.get(
      "/api/themes",
      { config: { public: true }, schema: { response: { 200: ThemesDTO } } },
      (req) => ({
        themes: registry.list(req.auth?.role === "admin"),
        defaultId: getDefaultTheme(db, registry),
      }),
    );

    app.get(
      "/api/themes/default",
      { config: { public: true }, schema: { response: { 200: z.object({ id: ThemeId }) } } },
      () => ({ id: getDefaultTheme(db, registry) }),
    );

    app.put(
      "/api/themes/default",
      {
        config: { role: "admin" },
        schema: { body: z.object({ id: ThemeId }), response: { 200: z.object({ id: ThemeId }) } },
      },
      (req) => {
        const { id } = req.body;
        if (!registry.get(id)) throw new HttpError(404, "not_found", `no working theme "${id}"`);
        setDefaultTheme(db, id, clock.now());
        auditRequest(db, clock, req, { action: "theme.default", target: id });
        return { id };
      },
    );

    app.post(
      "/api/themes/:id/duplicate",
      {
        config: { role: "admin" },
        schema: {
          params: z.object({ id: ThemeId }),
          body: DuplicateThemeBody,
          response: { 201: ThemeDTO },
        },
      },
      (req, reply) => {
        const source = registry.get(req.params.id);
        if (!source) throw new HttpError(404, "not_found", `no working theme "${req.params.id}"`);
        const { newId, name } = req.body;
        const userDir = registry.userDir;
        if (!userDir)
          throw new HttpError(409, "no_user_themes", "the themes data folder isn't available");
        const target = join(userDir, newId);
        if (registry.resolve(newId) || existsSync(target)) {
          throw new HttpError(409, "exists", `a theme called "${newId}" already exists`);
        }
        for (const file of listThemeFiles(source.dir)) {
          const to = join(target, ...file.split("/"));
          mkdirSync(dirname(to), { recursive: true });
          if (file === "theme.json") {
            const json = JSON.parse(readFileSync(join(source.dir, file), "utf8")) as Record<
              string,
              unknown
            >;
            writeFileSync(to, `${JSON.stringify({ ...json, id: newId, name }, null, 2)}\n`);
          } else {
            copyFileSync(join(source.dir, ...file.split("/")), to);
          }
        }
        // Now, rather than when the watcher notices.
        watcher.refresh(newId);
        auditRequest(db, clock, req, {
          action: "theme.duplicate",
          target: newId,
          details: { from: req.params.id },
        });
        const dto = registry.list(true).find((t) => t.id === newId);
        if (!dto) throw new HttpError(500, "internal_error", "the copy didn't load");
        void reply.code(201);
        return dto;
      },
    );

    // The files (CR-004 §4.2–4.3): allowlisted types only, never outside the folder;
    // cached for good when `?v=` is the current hash.
    app.get(
      "/themes/:id/*",
      {
        config: { public: true },
        schema: {
          params: z.object({ id: z.string(), "*": z.string() }),
          querystring: z.object({ v: z.string().optional() }),
        },
      },
      (req, reply) => {
        const entry = registry.get(req.params.id);
        const path = entry ? themeFilePath(entry, req.params["*"]) : null;
        if (!entry || !path) {
          return reply
            .code(404)
            .header("cache-control", NO_CACHE)
            .send({ error: "not_found", message: "no such theme file" });
        }
        const stat = statSync(path);
        const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
        reply
          .header("cache-control", req.query.v === entry.hash ? IMMUTABLE : NO_CACHE)
          .header("etag", etag)
          .type(THEME_FILE_TYPES[themeFileType(path) as ThemeFileType]);
        if (req.headers["if-none-match"] === etag) return reply.code(304).send();
        return reply.send(createReadStream(path));
      },
    );

    return Promise.resolve();
  };
}
