# CR-004 — Theme Loader, Picker, and Built-in Themes

| Field        | Value                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project      | MeshTerm                                                                                                                                                |
| CR ID        | CR-004                                                                                                                                                  |
| Title        | Finish the theme system: loader, picker, light/dark Default, Retro Terminal, effects layer, Cyberpunk                                                   |
| Requested by | Fireshaper                                                                                                                                              |
| Date         | 2026-10-22                                                                                                                                              |
| Priority     | High                                                                                                                                                    |
| Type         | Enhancement                                                                                                                                             |
| Depends on   | Existing tokens (`tokens.css`), `data-mt` hooks, cascade layers, Stylelint guard, `themes/default/`, `/themes/<id>/…` static route, CR-003 theme sounds |
| Related      | `app-design-document.md` §8, `map-view-spec.md` §6, `cr-node-detail-drawer.md` §7.2, `architecture.md` (hook list)                                      |

Build plan: [cr-004-plan.md](cr-004-plan.md).

---

## 1. Summary

The theme plumbing is in place (about 100 tokens, `data-mt` hooks, `@layer reset, base, theme, overrides`, a lint guard, and Default as a dark theme), but users can't add, pick or switch themes. This CR delivers the user-facing half, in six phases:

| Phase | Deliverable                                                                       | Est.              |
| ----- | --------------------------------------------------------------------------------- | ----------------- |
| A     | Theme loader, picker, live switching, no flash on load, Default light/dark/system | 2 days            |
| B     | `THEMING.md` author guide + hook audit                                            | 0.5–1 day         |
| C     | Retro Terminal theme                                                              | 2 days            |
| D     | Effects overlay + "disable effects"                                               | 0.5–1 day         |
| E     | Cyberpunk (Neon District) theme + per-theme map styles                            | 2–2.5 days        |
| F     | Per-theme visual baselines                                                        | 0.5 day           |
|       | **Total**                                                                         | **~8–9 dev days** |

Phases ship in order. A and B are required before C–F start.

## 2. Current state

| Area          | State                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Default theme | `themes/default/` with `theme.json` (`colorScheme: "dark"`) and ~110-line `theme.css`; light values kept in the file but unused |
| Tokens        | ~100 `--mt-*` tokens in `tokens.css` with system-color fallbacks; components use only tokens                                    |
| Hooks         | `data-mt` / `data-mt-state` / `data-mt-variant` on components, listed in `architecture.md`                                      |
| Cascade       | `@layer reset, base, theme, overrides`; e2e test proves themes override base without `!important`                               |
| Lint          | Stylelint blocks literal colors outside `themes/`                                                                               |
| Serving       | Server serves `/themes/<id>/…`; `index.html` hard-links Default's stylesheet                                                    |
| Sounds        | `theme.json` `sounds` map overrides notification sounds                                                                         |
| Motion        | Animations honor `prefers-reduced-motion`                                                                                       |
| Baselines     | Main screens at 1280 and 390 px, Default only                                                                                   |

Not built: loader, hot reload, `theme.changed` event, picker, light/dark choice, Retro, Cyberpunk, effects overlay, `map-style.json` support, `THEMING.md`, per-theme baselines.

## 3. Out of scope

- A live theme editor that exports `theme.css` (future CR)
- Per-user (account-level) theme preference; this CR keeps it per browser plus an admin default
- Theme marketplace / downloading themes from URLs
- Light variants of Retro or Cyberpunk

---

## 4. Phase A — Loader, picker, switching

### 4.1 Theme sources

| Source   | Path in container                                          | Writable | Notes                                            |
| -------- | ---------------------------------------------------------- | -------- | ------------------------------------------------ |
| Built-in | `/app/themes/` (from repo `themes/`, baked into the image) | No       | Default, Retro Terminal, Cyberpunk               |
| User     | `/data/themes/`                                            | Yes      | Drop-in folders; created on first run if missing |

- A user theme with the same `id` as a built-in **overrides** it (logged as a warning), so users can customize a built-in by copying its folder.
- Do **not** copy built-ins into `/data/themes` on start; that would freeze old versions across upgrades. Instead, add a "Duplicate as user theme" action (§4.6).

### 4.2 Manifest (`theme.json`)

Validate with Zod on load. Invalid themes are skipped with a logged error and shown in the picker as "Broken: <reason>" for admins only.

```ts
interface ThemeManifest {
  id: string; // [a-z0-9-]{1,40}, must match folder name
  name: string; // display name, ≤ 40 chars
  author?: string;
  version: string; // semver
  description?: string; // ≤ 200 chars
  colorScheme: "dark" | "light" | "auto";
  preview: { bg: string; surface: string; accent: string; text: string }; // CSS colors, for picker swatches
  entry?: string; // default "theme.css"
  modes?: { light?: string; dark?: string }; // optional extra CSS per mode, for 'auto' themes
  fonts?: Array<{ family: string; src: string; weight?: string; style?: string }>; // relative paths
  mapStyle?: string; // relative path to map-style.json (Phase E)
  sounds?: Record<"message" | "mention" | "channel", string>; // existing (CR-003)
  effects?: Array<"scanlines" | "glow" | "crt" | "noise" | "flicker">; // Phase D
  minAppVersion?: string; // warn if MeshTerm is older
}
```

Asset paths must be relative and stay inside the theme folder (reject `..`, absolute paths, URLs). Only `.css`, `.json`, `.woff2`, `.woff`, `.png`, `.svg`, `.webp`, `.jpg`, `.mp3`, `.ogg`, `.wav` are served; everything else 404s. **No JavaScript, ever.**

### 4.3 Server

| Item                                      | Behavior                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loader                                    | On start, scans both sources, validates manifests, builds a registry `{ id → manifest, source, path, hash }`. `hash` = content hash of the folder, used for cache busting. |
| `GET /api/themes`                         | Lists themes: manifest fields + `source`, `hash`, `valid`, `error?` (error only for admins)                                                                                |
| `GET /api/themes/default` / `PUT` (admin) | Server-wide default theme id (stored in `settings`)                                                                                                                        |
| Static                                    | `/themes/<id>/<file>?v=<hash>`; `Cache-Control: public, max-age=31536000, immutable` when `v` matches the current hash, otherwise `no-cache`                               |
| Hot reload                                | chokidar watches `/data/themes` (debounce 300 ms), re-validates the changed theme, updates the registry and broadcasts WS `theme.changed { id, hash, removed? }`           |
| CSP                                       | Fonts and images from `'self'` only; unchanged                                                                                                                             |

### 4.4 Client loading (no flash)

Replace the hard-coded stylesheet link in `index.html` with:

```html
<link id="mt-theme" rel="stylesheet" href="/themes/default/theme.css" />
<script>
  // Inline, runs before first paint. Keep tiny and dependency-free.
  (function () {
    try {
      var t = localStorage.getItem("mt.theme"); // {"id":"retro-terminal","hash":"abc123","mode":"dark"}
      if (t) {
        t = JSON.parse(t);
        document.getElementById("mt-theme").href = "/themes/" + t.id + "/theme.css?v=" + t.hash;
        document.documentElement.dataset.mtTheme = t.id;
        if (t.mode) document.documentElement.dataset.mtMode = t.mode;
      }
    } catch (e) {}
  })();
</script>
```

- The server injects a per-response nonce or hash for this inline script so CSP stays strict (`script-src 'self' 'sha256-…'`).
- On boot the app fetches `/api/themes`. If the stored theme no longer exists, it falls back to the server default, then to `default`.
- Extra mode CSS (`modes.light` / `modes.dark`) and font files are loaded via additional `<link>`/`FontFace` entries managed by a `ThemeProvider`.

### 4.5 Switching at runtime

`ThemeProvider` handles a switch as:

1. Preload the new stylesheet (and fonts) in a new `<link>` with `media="print"`, wait for `load`.
2. Swap: set `media="all"`, remove the old link, update `data-mt-theme` / `data-mt-mode` on `<html>`.
3. Emit a client-side `theme:applied` event.
4. Save `{ id, hash, mode }` to localStorage (try/catch).

**Every canvas or code-driven consumer must listen for `theme:applied` and re-read tokens.** This is the part never exercised so far, because the theme couldn't change:

| Consumer                                                | Must do on `theme:applied`                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Map (MapLibre)                                          | Re-run `useMapTokens()` → `setPaintProperty` for all MeshTerm layers; swap base style per §8.3 |
| Charts (uPlot)                                          | Re-run `useChartTokens()` → update series/axis/grid colors and redraw                          |
| Dashboard mini maps and sparklines                      | Re-read tokens / CSS filter                                                                    |
| Favicon badge (CR-003)                                  | Redraw with new badge tokens and the theme icon                                                |
| Sounds                                                  | Reload theme sound URLs                                                                        |
| Anything else that calls `getComputedStyle` for a token | Same                                                                                           |

Add an e2e test that opens Dashboard, Map, Messages and a node drawer with charts, switches theme, and asserts sampled canvas pixels and computed colors changed **without a reload**.

When `theme.changed` arrives over WS for the active theme (a user edited it in `/data/themes`), re-apply it with the new hash. Also refresh the picker list.

### 4.6 Default: light / dark / system

- Change Default's manifest to `colorScheme: "auto"`.
- `theme.css` holds shared tokens plus the dark palette under `:root:where([data-mt-mode="dark"])` and the light palette under `:root:where([data-mt-mode="light"])`.
- **Mode** is a separate per-browser setting: `System` (default; follows `prefers-color-scheme` and updates live on change) · `Light` · `Dark`. For System, the provider sets `data-mt-mode` from the media query.
- Themes with `colorScheme: "dark"` or `"light"` ignore the mode setting, and the picker greys it out for them.
- Set `<meta name="color-scheme">` and `color-scheme` on `:root` to match, so native controls and scrollbars follow.

### 4.7 Picker UI

`Settings → Appearance`:

```
Appearance
──────────
Theme
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ ▓▓░░ ■    │ │ ▓▓░░ ■    │ │ ▓▓░░ ■    │ │ ▓▓░░ ■    │   preview swatches
│ Default ✓ │ │ Retro     │ │ Cyberpunk │ │ My Theme  │
│ built-in  │ │ built-in  │ │ built-in  │ │ user      │
└───────────┘ └───────────┘ └───────────┘ └───────────┘

Mode          ( System ) ( Light ) ( Dark )          (Default only)
Effects       [✓] Enable theme effects                (Phase D)
Server default theme   [ Default ▾ ]                  (admin only)
[Open themes folder help]  [Duplicate selected as user theme] (admin)
```

- **Hover / focus previews** the theme live (temporary apply); leaving restores the current one; click commits. Disabled when `prefers-reduced-motion` is set, since the rapid restyle is jarring.
- Cards show name, author, version, source badge (built-in / user / overrides built-in), description, and an effects badge.
- Broken themes (admins only) show the validation error.
- **Duplicate as user theme** (admin): copies a theme folder to `/data/themes/<new-id>/` with a new id/name. This is the starting point for customizing.
- A theme switcher shortcut also lives in the header user menu.

### 4.8 Phase A acceptance

- [ ] `/api/themes` lists built-in and user themes; invalid manifests are skipped with an error visible to admins
- [ ] Dropping a valid theme folder into `/data/themes` makes it appear in the picker within 2 s without restart
- [ ] Editing a user theme's CSS updates open browsers live via `theme.changed`
- [ ] Picker switches themes instantly with no reload; hover preview works
- [ ] **Map, charts, mini maps, sparklines and favicon badge recolor on switch without reload** (e2e)
- [ ] Reloading with a non-default theme selected shows **no flash** of Default (Playwright: screenshot first paint)
- [ ] Default supports System / Light / Dark; System tracks OS changes live
- [ ] Admin can set the server default; new browsers get it
- [ ] Paths outside a theme folder, non-allowlisted file types and any `.js` are refused
- [ ] Cache busting via hash works: an edited theme is never served stale

---

## 5. Phase B — `THEMING.md` and hook audit

### 5.1 `THEMING.md` (repo root, linked from README and Settings → Appearance)

Contents:

1. **What a theme is:** folder layout, manifest reference (every field, with an example), allowed file types, no-JS rule.
2. **Where to put it:** `/data/themes/<id>/`, hot reload, overriding/duplicating a built-in.
3. **Token reference:** every `--mt-*` token grouped (surface, text, accent/status, bubbles, signal scale, typography, shape, motion, cards, battery, map, charts, badges, toasts, mentions, drawer, config fields…), with its default value and what uses it. **Generated** from `tokens.css` by a script (`pnpm docs:tokens`) using structured comments, so it can't drift.
4. **Hook reference:** every `data-mt` value with its states/variants and the screen it's on. Generated from a hook registry (see 5.2).
5. **Light/dark:** how `colorScheme`, `data-mt-mode` and `modes` work.
6. **Canvas surfaces:** which tokens the map and charts read, and `map-style.json`.
7. **Effects:** the `fx-layer` and manifest `effects`.
8. **Sounds and fonts.**
9. **Your first theme in 10 minutes:** a walkthrough that duplicates Default, changes 6 tokens and one hook override, and shows the result.
10. **Accessibility checklist:** contrast (WCAG AA 4.5:1 for text), focus visibility, reduced motion, not relying on color alone for status.

### 5.2 Hook audit

- Create `packages/shared/src/theme-hooks.ts` exporting every hook name with its allowed states/variants. Components import from it instead of string literals (enforce with an ESLint rule on `data-mt` attributes).
- Write a Playwright test that crawls main screens and fails if a meaningful element (buttons, inputs, list rows, cards, panels, dialogs, badges, toasts) lacks a `data-mt` attribute or uses an unregistered value.
- Fix any gaps found. Retro Terminal (Phase C) depends on this.

### 5.3 Phase B acceptance

- [ ] `THEMING.md` exists, covers §5.1, and its token/hook tables are generated
- [ ] Hook registry in `shared`; lint rule and crawl test pass
- [ ] A developer can follow the walkthrough and produce a working user theme

---

## 6. Phase C — Retro Terminal

### 6.1 Look

- **Palette:** phosphor green on near-black, with an **amber variant** via a second manifest (`retro-terminal-amber`) that imports the shared CSS and overrides about 6 color tokens.
- **Type:** monospace everywhere (bundled `.woff2`, e.g. IBM Plex Mono or JetBrains Mono, OFL licensed); a slightly larger base size.
- **Shape:** radius 0, 1 px borders, no shadows. Panels drawn with border tokens to look like box-drawing frames.
- **Motion:** none, apart from a blinking block cursor in the composer (off under reduced motion).
- **Status colors** stay distinguishable without hue (brightness steps plus symbols), since everything is one color family.

### 6.2 Screen treatments (via hooks only, no component changes)

| Screen                  | Treatment                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messages                | Bubbles flattened into log lines: `[10:04] <K7AB> Heading out now`. Outgoing lines prefixed with `>`; delivery state shown as `[..]` queued, `[ok]` acked, `[!!]` failed via `::after` on `delivery-status`. Day separators as `--- Tue 20 Oct ---`. Reactions as `* K7AB reacted 👍`. |
| Conversation list       | `#channel` and `@peer` rows, unread as `(3)`                                                                                                                                                                                                                                           |
| Dashboard cards         | Framed boxes, headers in reverse video, battery as `[#####-----] 52%` (via `battery-meter` hook + `--mt-battery-*` tokens and a CSS-drawn bar)                                                                                                                                         |
| Node list               | Dense, aligned columns                                                                                                                                                                                                                                                                 |
| Toasts                  | Inverted status line at the top: `*** K7AB: Heading out…`                                                                                                                                                                                                                              |
| Map                     | Monochrome base map via `map-style.json` (`raster-saturation: -1`, tint with `raster-hue-rotate`, raised contrast); square-ish node dots, monospace labels, no blur                                                                                                                    |
| Charts                  | Single-hue series differentiated by dash patterns, if the chart token bridge supports a dash token (add `--mt-chart-N-dash` if not)                                                                                                                                                    |
| Sounds                  | Short terminal beeps (bundled)                                                                                                                                                                                                                                                         |
| Effects (after Phase D) | `crt` + `scanlines`, subtle                                                                                                                                                                                                                                                            |

If any of these can't be achieved through tokens and hooks, file the gap against Phase B, i.e. add a hook. Don't special-case Retro in component code.

### 6.3 Phase C acceptance

- [ ] Retro Terminal and Retro Terminal Amber selectable
- [ ] Messages render as log lines, with delivery state, using CSS only
- [ ] All main screens usable and AA-contrast compliant in both variants
- [ ] Map and charts match the theme and switch live
- [ ] No component code references the Retro theme

---

## 7. Phase D — Effects overlay

- `App` renders a single `<div data-mt="fx-layer" aria-hidden="true">` above content: `position: fixed; inset: 0; pointer-events: none; z-index` from a `--mt-z-fx` token.
- Effects are pure CSS in the theme, keyed by `html[data-mt-fx~="scanlines"]` etc. The provider sets `data-mt-fx` from the manifest's `effects` when effects are enabled.
- Effect vocabulary (themes may implement any subset): `scanlines`, `glow`, `crt` (vignette/curvature illusion), `noise`, `flicker`.
- **Disable effects** toggle in Settings → Appearance (per browser). Effects are also force-disabled when:
  - `prefers-reduced-motion: reduce` (for animated effects such as flicker and noise movement; static scanlines may stay)
  - `prefers-contrast: more`
  - the browser reports low performance (optional: skip if the frame rate drops below 30 fps for 3 s during an effect animation)
- Performance budget: effects must not drop scrolling below 55 fps on a mid-range laptop. Prefer static gradients and `background` repeats over animated filters; never animate `backdrop-filter`.
- Effects must never cover text with anything that drops contrast below AA.

### 7.1 Phase D acceptance

- [ ] `fx-layer` exists, ignores pointer events, has no layout impact
- [ ] Effects driven by manifest + `data-mt-fx`; toggle and media-query overrides work
- [ ] Scroll performance within budget with effects on (Playwright trace on Messages and Dashboard)

---

## 8. Phase E — Cyberpunk (Neon District) and map styles

### 8.1 Look

- **Palette:** near-black blue background, hot pink primary accent, cyan secondary, magenta/violet highlights; status colors stay distinct (don't make "danger" and the accent the same pink).
- **Type:** a display font for headings (bundled, OFL; e.g. Orbitron or Rajdhani) and a clean UI font for body text. Body text must stay highly readable.
- **Shape:** angled panel corners via `clip-path` on hook selectors (cards, drawer, toasts, dialogs), 1–2 px neon borders.
- **Glow:** `box-shadow`/`text-shadow` on focus, active and new-message states. Restrained by default; stronger under `effects: glow`.
- **Effects:** `scanlines`, `glow`, subtle `noise`; optional chromatic-aberration on headings only.
- **Motion:** glitch entrance for toasts; `updated` card flash as a neon pulse; all disabled under reduced motion.
- **Sounds:** synth blip set (bundled).

### 8.2 Screen treatments

| Screen    | Treatment                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| Dashboard | Neon-bordered angled cards; self card in cyan; status dots glow; battery meter as a segmented bar                |
| Messages  | Outgoing bubbles pink, incoming cyan-outlined; mention highlight in magenta                                      |
| Map       | Dark base with neon roads (see 8.3); glowing node dots (`circle-blur`), magenta traceroutes, cyan neighbor links |
| Charts    | Neon series on a dark grid with soft glow                                                                        |
| Toasts    | Glitch-in, pink border, glow                                                                                     |

### 8.3 Per-theme map styles

Implement the `mapStyle` manifest field:

- `map-style.json` is a **partial** MapLibre style containing only base-map pieces: `sources` for base tiles and `layers` for base-map rendering. MeshTerm's own layers (nodes, links, routes, trails) always come from code and stay on top.
- **Raster (current OSM tiles):** themes adjust the raster layer's paint (`raster-saturation`, `raster-hue-rotate`, `raster-contrast`, `raster-brightness-min/max`, `raster-opacity`). Cyberpunk: darkened, desaturated, hue-shifted toward blue with boosted contrast, so roads read as light lines. Retro: full desaturation with a green/amber tint.
- **Vector (when the PMTiles option from the map spec exists):** themes may supply full vector layer styling for true neon roads. Out of scope until vector maps ship, but the loader should accept vector sources so no format change is needed later.
- Themes **cannot** change the tile URL away from the server proxy or remove attribution. The loader rewrites/validates `sources` so tiles always go through `/api/tiles`, and the attribution control is always present.
- On theme switch, swap the base map with `map.setStyle(merged, { diff: true })` or by updating the base layer's paint properties, keeping the camera and MeshTerm layers intact.
- Dashboard mini maps (static tiles) mirror the raster adjustments with an equivalent CSS `filter` derived from the same values (`saturate()`, `hue-rotate()`, `contrast()`, `brightness()`), applied only to `[data-mt="mini-map-tiles"]`.

### 8.4 Phase E acceptance

- [ ] Cyberpunk selectable; all main screens styled, readable and AA-compliant
- [ ] Glow/scanlines tied to the effects layer and its toggle
- [ ] `map-style.json` supported; Cyberpunk and Retro restyle the base map; camera and overlays preserved on switch
- [ ] Mini maps match the main map's look per theme
- [ ] Tiles still load only via `/api/tiles`; attribution always visible
- [ ] Reduced motion disables glitch/pulse animations

---

## 9. Phase F — Visual baselines

- Extend the Playwright visual suite to every built-in theme and mode: **Default Light, Default Dark, Retro Terminal, Retro Terminal Amber, Cyberpunk**, at 1280 and 390 px.
- Screens: Dashboard, Map, Messages (list + DM thread with reply, reaction, failed message), Node drawer (Overview + Telemetry), Settings → Device (one section with a changed field), Settings → Appearance, a toast, the notification center.
- Run the effects-on variant for Retro and Cyberpunk at 1280 only; mask animated regions.
- Contrast check: run axe-core color-contrast rules per theme and fail on AA violations in text.
- CI publishes the screenshots as an artifact for review.

### 9.1 Phase F acceptance

- [ ] Baselines committed for all themes/modes/screens/widths listed
- [ ] axe contrast passes for all themes
- [ ] Changing a token in one theme only affects that theme's baselines

---

## 10. Data and API summary

| Item                             | Change                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `settings`                       | Add `theme.default` (theme id)                                                    |
| `GET /api/themes`                | New                                                                               |
| `GET/PUT /api/themes/default`    | New (PUT admin)                                                                   |
| `POST /api/themes/:id/duplicate` | New (admin): `{ newId, name }` → copies to `/data/themes`                         |
| `/themes/<id>/<file>?v=<hash>`   | Existing route; add allowlist, path safety, hash-based caching, user-theme source |
| WS `theme.changed`               | New: `{ id, hash, removed? }`                                                     |
| localStorage `mt.theme`          | `{ id, hash, mode }`; `mt.effects` boolean                                        |

## 11. Theming hooks / tokens added by this CR

Hooks: `data-mt="appearance-settings"`, `"theme-card"` (state `active`, `previewing`, `broken`; variant `builtin|user|override`), `"theme-swatch"`, `"mode-toggle"`, `"effects-toggle"`, `"fx-layer"`.

Tokens: `--mt-z-fx`, `--mt-chart-1-dash` … `--mt-chart-6-dash` (if added in Phase C), `--mt-font-display` (exists; ensure Cyberpunk uses it).

## 12. Risks

| Risk                                                           | Mitigation                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Canvas consumers never re-read tokens (untested so far)        | `theme:applied` event contract + explicit e2e in Phase A                                                                         |
| Flash of Default on load                                       | Inline head script with CSP hash (§4.4)                                                                                          |
| Hook gaps block Retro's log-line look                          | Phase B hook audit and crawl test before Phase C                                                                                 |
| Effects hurt performance or readability                        | Performance budget, toggle, media-query overrides, AA checks                                                                     |
| User themes break the UI                                       | Validation, file allowlist, "Broken" state, and any theme can be switched away from via `?theme=default` URL override (add this) |
| Themes used to exfiltrate data (CSS `url()` to external hosts) | CSP `img-src 'self'`, `font-src 'self'`; no external URLs allowed in manifests; loader warns on `url(http…)` in CSS              |
| Font licensing                                                 | Only bundle OFL/Apache fonts; record licenses in each theme folder (`LICENSES.md`)                                               |

## 13. Acceptance (overall)

All phase acceptance lists in §4.8, §5.3, §6.3, §7.1, §8.4 and §9.1 pass, and:

- [ ] `?theme=<id>` query param forces a theme for that page load (recovery from a broken theme and for screenshots)
- [ ] README updated: themes overview, `/data/themes`, link to `THEMING.md`
- [ ] No component code references a specific theme id
