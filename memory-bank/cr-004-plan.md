# CR-004 Themes — build plan

CR: [cr-004-themes.md](cr-004-themes.md). Stop after each phase, report, commit and push.

## Where the code is today (2026-10-22)

- **Serving:** [static.ts](../apps/server/src/routes/static.ts) serves the built-in `themes/` folder with `@fastify/static` at `/themes/`, `no-cache`, with no file-type allowlist and no `?v=` caching. [paths.ts](../apps/server/src/paths.ts) resolves only the built-in folder. `/data` is `MESHTERM_DATA_DIR`; there's no `/data/themes` yet.
- **index.html** hard-links `/themes/default/theme.css` (`data-mt="theme-link"`) and has an inline `<style>` with the layer order, allowed by hash. Script CSP is `'self'` only; the updated CR uses a blocking external `/theme-boot.js`, so the CSP doesn't change.
- **Default theme:** dark under `:root`, light under `:root[data-mt-scheme="light"]` (unused). The CR uses `data-mt-mode`, so the attribute is renamed. Nothing outside Default uses it.
- **Re-reading tokens:** [useThemeChange.ts](../apps/web/src/components/useThemeChange.ts) already watches `href` on the theme link and the `data-mt-theme` / `data-mt-scheme` attributes on `<html>` with a MutationObserver. Map (`MapPage`) and charts (`ChartTabs`) use it. Mini maps, sparklines, the favicon badge (`tab.ts`), `MapPicker` and theme sounds (`sounds.ts` reads the link's `href`) don't, and nothing has ever really switched a theme. It becomes the `theme:applied` listener.
- **Tokens:** about 100 in [tokens.css](../apps/web/src/styles/tokens.css). No `--mt-font-display` (added in A2), `--mt-z-fx` or chart dash tokens. There's no `--mt-font-ui` either: the body font is `--mt-font-body`.
- **Hooks:** string literals in components; the list is in `architecture.md`. There's no registry and no lint rule.
- **Missing dependencies:** `chokidar` (named in tech-stack.md, not installed) and `@axe-core/playwright` (Phase F).
- **Storage keys:** `meshterm.theme` and `meshterm.effects`, like the existing `meshterm.*` keys (updated CR).

## Phase A1: server — registry, user themes, safe serving, hot reload, API (done 2026-10-22)

- `apps/server/src/themes/`:
  - `manifest.ts`: the Zod `ThemeManifest` (in `shared`, so the web uses it too). It checks the id against the folder name, relative paths inside the folder (no `..`, absolute paths or URLs) and the preview colors.
  - `registry.ts`: scans the built-in folder and `<dataDir>/themes` (created if missing). A user theme with a built-in's id overrides it (warning). Each theme gets a content hash of its allowed files. Broken themes are kept with their error. It warns on `url(http…)` in CSS.
  - `watcher.ts`: chokidar (new dependency) on `<dataDir>/themes`, debounced 300 ms per theme folder; `MESHTERM_THEMES_POLL=1` switches to polling (NFS/SMB/bind mounts). The env var goes into `.env.example`, the README and the config schema. It rescans that folder and publishes hub `theme.changed {id, hash, removed?}`.
- **Static route:** replace the `@fastify/static` theme root with a handler that looks the id up in the registry. It serves only the allowlisted extensions, refuses anything else (including `.js`) with 404, and stays inside the folder (symlinks resolved). Caching is `immutable` when `?v=` matches the current hash and `no-cache` otherwise.
- **Routes:**
  - `GET /api/themes`: the list. `error` is shown to admins only, and viewers don't see broken themes.
  - `GET /api/themes/default`, `PUT` (admin): `settings` key `theme.default`. An unknown id is refused.
  - `POST /api/themes/:id/duplicate` (admin): `{newId, name}`. It copies the allowlisted files into `<dataDir>/themes/<newId>/`, rewrites `id`/`name` in the copy's `theme.json`, refuses existing ids, and is audited.
- **Shared:** WS `theme.changed`, the theme DTOs, the snapshot carries the server default.
- **FakeNode:** nothing. Nothing here transmits on the mesh.
- **Tests:**
  - manifest validation;
  - path safety and allowlist (`..`, `%2e%2e`, absolute paths, `.js`, symlinks out);
  - hash caching;
  - override precedence;
  - duplicate;
  - hot reload: add, edit and remove a folder → registry and event within 2 s.

## Phase A2: client — ThemeProvider, no flash, modes, picker (done 2026-10-22)

- **index.html:** the theme link plus `<script src="/theme-boot.js">` (blocking, no `defer`), from `apps/web/public/`, so Vite copies it and the server's static root serves it. The script (< 1 KB) reads `meshterm.theme`, handles `?theme=<id>` (a one-load override, never saved) and sets `data-mt-mode` for System from `matchMedia`. The CSP stays `script-src 'self'`, and `csp.spec` keeps walking every screen with zero violations.
- **`src/theme/`:**
  - `ThemeProvider`:
    - Boot: fetch `/api/themes`. Fall back from a missing theme to the server default, then to `default`.
    - Switch: preload the stylesheet as `media="print"`, then swap it in.
    - Load mode CSS (`modes`) and fonts (`FontFace`).
    - Mode: System / Light / Dark. System tracks `prefers-color-scheme` live. Fixed-scheme themes ignore the mode.
    - Set `<meta name="color-scheme">`.
    - Emit `theme:applied` and save the choice.
    - `theme.changed` re-applies the active theme with its new hash and refreshes the list.
  - `useThemeChange` listens for `theme:applied` instead of the MutationObserver.
  - Every consumer re-reads its tokens: map (paint properties), charts, mini maps, sparklines, the favicon badge, `MapPicker` and sounds.
- **Tokens:** `--mt-font-display`, defaulting to `var(--mt-font-body)` (the CR's `--mt-font-ui` doesn't exist), applied to headings (page titles, card and drawer headers).
- **Default theme:** `colorScheme: "auto"`; `data-mt-scheme` renamed to `data-mt-mode` with no alias. The dark palette moves under `:root:where([data-mt-mode="dark"])` and light under `…="light"`. Add `preview` swatches.
- **Settings → Appearance** (`appearance-settings`):
  - theme cards (`theme-card` with state and variant, `theme-swatch`);
  - hover and focus preview, off under reduced motion;
  - mode toggle (`mode-toggle`), greyed out for fixed-scheme themes;
  - server default select and Duplicate (admins);
  - broken themes shown to admins.
- **Header user menu:** a theme shortcut.
- **Tests:**
  - provider unit tests: fallback, mode, preview and restore, storage failures;
  - Appearance component tests;
  - e2e: switch themes and see the map and chart canvases, mini map, sparkline and favicon recolor without a reload. This needs a test-only second theme in `e2e/fixtures/themes`, since Retro doesn't exist yet;
  - e2e: no flash of Default on first paint after a reload;
  - e2e: `?theme=` override;
  - e2e: dropping a folder into the data dir shows it in the picker, and editing its CSS updates an open page.
- **Visual baselines:** Appearance (Default Dark) and Default Light for the existing screens.

## Phase B: THEMING.md, generated references, hook registry

- `packages/shared/src/theme-hooks.ts`: every hook with its states and variants. Components switch to it (`hook("toast")` or a typed constant) in one sweep.
- An ESLint rule (local plugin) flags a literal `data-mt` value that isn't in the registry.
- Structured comments in `tokens.css` (`/** @group Surface — used by … */`).
- `scripts/docs-tokens.mjs` (`pnpm docs:tokens`) regenerates the token and hook tables in `THEMING.md` between markers. A check in CI (`docs:tokens --check`) fails when the file has drifted.
- **`THEMING.md`** covers everything in CR §5.1, including the 10-minute walkthrough and the accessibility checklist. README and Appearance link to it.
- **Crawl test:** a Playwright spec that visits the main screens and fails on meaningful elements without a hook, or with an unregistered value. Fix the gaps it finds.

## Phase C: Retro Terminal (+ Amber)

- **Folders:** `themes/retro-terminal/` and `themes/retro-terminal-amber/`. Amber `@import`s the shared CSS from the green theme by a relative URL served through the theme route. Each folder carries its own `LICENSES.md`.
- **Font:** a bundled OFL monospace font in `.woff2`.
- **CSS-only screen treatments from CR §6.2:**
  - message log lines, with delivery state in `::after`;
  - day separators;
  - conversation rows as `#channel` / `@peer`;
  - framed cards and a text battery bar;
  - a status-line toast;
  - a dense node list.
- Hooks found missing go into Phase B's registry; nothing in component code names the theme.
- **Chart dash tokens:** `--mt-chart-N-dash` read by the chart bridge (empty means solid).
- **Sounds:** terminal beeps.
- **Map:** waits for E's `map-style.json`, apart from the token colors.

## Phase D: effects overlay

- One `fx-layer` in the app shell, `--mt-z-fx`. The provider sets `data-mt-fx` from the manifest's `effects` when they're enabled.
- The "Enable theme effects" toggle (`effects-toggle`, saved per browser).
- **Force-off rules:** reduced motion turns off animated effects (flicker, moving noise); `prefers-contrast: more` turns off all of them. The optional FPS guard is skipped for now.
- **Retro effects:** `crt` and `scanlines`.
- **Performance check:** a Playwright trace on Messages and Dashboard scroll with effects on.

## Phase E: Cyberpunk and map styles

- `themes/cyberpunk/` (Neon District):
  - fonts: OFL display and body fonts, with `--mt-font-display` added to the tokens;
  - shape and motion: `clip-path` corners, glow, a glitch-in toast, the neon pulse, scanlines and noise;
  - synth sounds.
- **`mapStyle` support:**
  - The loader validates the partial style.
  - Raster `sources` are forced to `/api/tiles`, and the attribution stays.
  - On a switch, only the base layer's paint properties change, so the camera and MeshTerm's layers stay.
  - Mini maps get the equivalent CSS `filter` on `mini-map-tiles`.
  - Vector sources are accepted but not used yet.
- **Retro map styles:** green and amber tints.

## Phase F: per-theme baselines and contrast

- The visual suite runs across themes: Default Light and Dark, Retro, Retro Amber and Cyberpunk, at 1280 and 390 px, on the CR §9 screens.
- Effects-on runs for Retro and Cyberpunk at 1280 only, with animations masked.
- `@axe-core/playwright` (new dev dependency) color-contrast checks per theme.
- CI uploads the screenshots as an artifact.
- **CI cost control** (CR §9):
  - every PR: Default Light and Dark on all screens at both widths, Retro and Cyberpunk smoke shots (Dashboard and Messages at 1280 px), axe for all themes;
  - the full matrix nightly (a `schedule` workflow) and on PRs or pushes that touch `themes/**`, `tokens.css` or the hook registry (path filters);
  - Playwright sharded across parallel jobs.

## Decisions to record when building

- `data-mt-scheme` is renamed to `data-mt-mode` with no alias (CR §4.6); only Default used it.
- Storage keys `meshterm.theme` and `meshterm.effects` (CR §10).
- The no-flash boot script is an external `/theme-boot.js` (CR §4.4), so the CSP doesn't change.
- `--mt-font-display` defaults to `var(--mt-font-body)`: the CR's `--mt-font-ui` doesn't exist.
- CR §12 still lists "inline head script with CSP hash" as the flash mitigation; §4.4 (external script) wins.
- The theme hash covers only the allowlisted files in the folder, so it changes exactly when something served changes.
- Viewers never see broken themes; admins see them with the error.
