import { z } from "zod";

/** Theme ids: lowercase letters, digits and dashes; the folder has the same name (CR-004 §4.2). */
export const ThemeId = z.string().regex(/^[a-z0-9-]{1,40}$/, "a-z, 0-9 and -, at most 40");
export type ThemeId = z.infer<typeof ThemeId>;

/** The only files a theme folder serves; everything else (any script) is a 404. */
export const THEME_FILE_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
} as const;
export type ThemeFileType = keyof typeof THEME_FILE_TYPES;

/** `.css` for `x/Theme.CSS`; null without an extension. */
export function themeFileType(path: string): string | null {
  const m = /\.[a-z0-9]+$/i.exec(path);
  return m ? m[0].toLowerCase() : null;
}

/**
 * A path inside a theme folder: relative, no `..`, no URL scheme or backslashes, and of
 * one of the given file types.
 */
export function isThemeAssetPath(path: string, types: readonly string[]): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (!/^[\w./ -]+$/.test(path)) return false;
  if (path.startsWith("/") || path.split("/").some((s) => s === ".." || s === "." || s === "")) {
    return false;
  }
  const type = themeFileType(path);
  return type !== null && types.includes(type);
}

// No transforms: the same schema serializes API responses.
const asset = (types: readonly ThemeFileType[]) =>
  z.string().refine((p) => isThemeAssetPath(p, types), {
    message: `a relative path inside the theme folder (${types.join(", ")})`,
  });

const CSS = [".css"] as const;
const FONTS = [".woff2", ".woff"] as const;
const SOUNDS = [".wav", ".mp3", ".ogg"] as const;

/** A preview swatch color: a plain CSS color, never a `url()`. */
const SwatchColor = z
  .string()
  .max(60)
  .regex(
    /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\)|[a-z]+)$/i,
    "a CSS color",
  );

export const THEME_EFFECTS = ["scanlines", "glow", "crt", "noise", "flicker"] as const;
export const ThemeEffect = z.enum(THEME_EFFECTS);
export type ThemeEffect = z.infer<typeof ThemeEffect>;

/** `theme.json` (CR-004 §4.2). Unknown fields are ignored. */
export const ThemeManifest = z.object({
  id: ThemeId,
  name: z.string().trim().min(1).max(40),
  author: z.string().trim().max(80).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, "semver, e.g. 1.0.0"),
  description: z.string().trim().max(200).optional(),
  colorScheme: z.enum(["dark", "light", "auto"]),
  preview: z.object({
    bg: SwatchColor,
    surface: SwatchColor,
    accent: SwatchColor,
    text: SwatchColor,
  }),
  entry: asset(CSS).default("theme.css"),
  modes: z.object({ light: asset(CSS).optional(), dark: asset(CSS).optional() }).optional(),
  fonts: z
    .array(
      z.object({
        family: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\w -]+$/, "letters, digits, spaces and dashes"),
        src: asset(FONTS),
        weight: z
          .string()
          .regex(/^\d{3}( \d{3})?$|^(normal|bold)$/)
          .optional(),
        style: z.enum(["normal", "italic"]).optional(),
      }),
    )
    .max(12)
    .optional(),
  mapStyle: asset([".json"]).optional(),
  sounds: z
    .object({
      message: asset(SOUNDS).optional(),
      mention: asset(SOUNDS).optional(),
      channel: asset(SOUNDS).optional(),
    })
    .optional(),
  effects: z.array(ThemeEffect).max(THEME_EFFECTS.length).optional(),
  minAppVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
});
export type ThemeManifest = z.output<typeof ThemeManifest>;
export type ThemeManifestInput = z.input<typeof ThemeManifest>;

/** `builtin`, `user` (only in /data/themes), or `override` (a user theme with a built-in's id). */
export const ThemeSource = z.enum(["builtin", "user", "override"]);
export type ThemeSource = z.infer<typeof ThemeSource>;

export const ThemeDTO = z.object({
  /** The folder name (the manifest's id when valid). */
  id: z.string(),
  source: ThemeSource,
  /** Content hash of the served files; goes in `?v=` for caching. */
  hash: z.string(),
  valid: z.boolean(),
  /** Null when broken. */
  manifest: ThemeManifest.nullable(),
  /** Admins only: why it's broken. */
  error: z.string().optional(),
  /** Admins only: problems that don't stop it working (e.g. external `url()`s in CSS). */
  warnings: z.array(z.string()).optional(),
});
export type ThemeDTO = z.infer<typeof ThemeDTO>;

/** The built-in fallback every browser can rely on. */
export const DEFAULT_THEME_ID = "default";

export const ThemesDTO = z.object({
  themes: z.array(ThemeDTO),
  /** The server-wide default (admin setting), always a valid theme. */
  defaultId: ThemeId,
});
export type ThemesDTO = z.infer<typeof ThemesDTO>;

export const DuplicateThemeBody = z.object({
  newId: ThemeId,
  name: z.string().trim().min(1).max(40),
});
export type DuplicateThemeBody = z.infer<typeof DuplicateThemeBody>;

const LayerId = z.string().regex(/^[\w-]{1,40}$/, "letters, digits, _ and -");
const Unit = z.number().min(0).max(1);
const Signed = z.number().min(-1).max(1);

/**
 * `map-style.json` (CR-004 §8.3): a partial MapLibre style for the base map only.
 * Background and raster layers are drawn now, with a fixed set of paint properties and
 * plain values; tiles always come through MeshTerm's proxy, so sources only say their
 * type (anything else in them is ignored). Vector layers are accepted for later
 * (PMTiles) but not drawn yet.
 */
export const ThemeMapStyle = z.object({
  version: z.literal(8).optional(),
  sources: z.record(z.string(), z.looseObject({ type: z.enum(["raster", "vector"]) })).optional(),
  layers: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          id: LayerId,
          type: z.literal("background"),
          paint: z
            .strictObject({
              "background-color": SwatchColor.optional(),
              "background-opacity": Unit.optional(),
            })
            .optional(),
        }),
        z.object({
          id: LayerId,
          type: z.literal("raster"),
          source: z.string().optional(),
          paint: z
            .strictObject({
              "raster-opacity": Unit.optional(),
              "raster-hue-rotate": z.number().min(-360).max(360).optional(),
              "raster-brightness-min": Unit.optional(),
              "raster-brightness-max": Unit.optional(),
              "raster-saturation": Signed.optional(),
              "raster-contrast": Signed.optional(),
            })
            .optional(),
        }),
        z.looseObject({
          id: LayerId,
          type: z.enum([
            "fill",
            "line",
            "symbol",
            "circle",
            "fill-extrusion",
            "heatmap",
            "hillshade",
          ]),
          source: z.string(),
        }),
      ]),
    )
    .max(100),
});
export type ThemeMapStyle = z.infer<typeof ThemeMapStyle>;
