# Theming MeshTerm

Every color, font, size and shape in MeshTerm comes from a theme. A theme is a folder with a small manifest and a CSS file: no JavaScript, no build step. Drop a folder into `/data/themes` and it shows up in **Settings → Appearance** within seconds. Edit its CSS, and every open browser updates while you watch.

This guide covers:

1. [What a theme is](#what-a-theme-is)
2. [Where to put it](#where-to-put-it)
3. [Your first theme in 10 minutes](#your-first-theme-in-10-minutes)
4. [How styling works: layers, tokens and hooks](#how-styling-works)
5. [Light and dark](#light-and-dark)
6. [Canvas surfaces: the map and charts](#canvas-surfaces-the-map-and-charts)
7. [Effects](#effects)
8. [Fonts and sounds](#fonts-and-sounds)
9. [Accessibility checklist](#accessibility-checklist)
10. [Token reference](#token-reference)
11. [Hook reference](#hook-reference)

## What a theme is

A folder named after the theme's id:

```text
my-theme/
├── theme.json        the manifest (required)
├── theme.css         the styles (required; another name via "entry")
├── fonts/…           optional .woff2 / .woff files
├── sounds/…          optional .wav / .mp3 / .ogg files
├── map-style.json    optional base-map style
└── LICENSES.md       credits for any fonts, images or sounds you bundle
```

### The manifest: `theme.json`

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "author": "You",
  "version": "1.0.0",
  "description": "Warm colors for evening use.",
  "colorScheme": "dark",
  "preview": { "bg": "#1a1410", "surface": "#2a211a", "accent": "#ff9f43", "text": "#f5e9dc" }
}
```

| Field           | Required | What it does                                                                                                                                    |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | yes      | Lowercase letters, digits and dashes, at most 40 characters. **Must match the folder name.**                                                    |
| `name`          | yes      | Shown in the picker, at most 40 characters.                                                                                                     |
| `version`       | yes      | `major.minor.patch`, e.g. `1.0.0`.                                                                                                              |
| `colorScheme`   | yes      | `dark`, `light`, or `auto` (the theme has both; see [Light and dark](#light-and-dark)).                                                         |
| `preview`       | yes      | Four plain CSS colors (`bg`, `surface`, `accent`, `text`) for the picker's swatch.                                                              |
| `author`        | no       | Shown on the card.                                                                                                                              |
| `description`   | no       | Up to 200 characters, shown on the card.                                                                                                        |
| `entry`         | no       | The main stylesheet. Default `theme.css`.                                                                                                       |
| `modes`         | no       | `{ "light": "light.css", "dark": "dark.css" }`: extra CSS loaded only in that mode (`auto` themes).                                             |
| `fonts`         | no       | `[{ "family": "Orbitron", "src": "fonts/orbitron.woff2", "weight": "400 900", "style": "normal" }]`. See [Fonts and sounds](#fonts-and-sounds). |
| `sounds`        | no       | `{ "message": "sounds/dm.wav", "mention": "sounds/mention.wav", "channel": "sounds/channel.wav" }`.                                             |
| `mapStyle`      | no       | A base-map style file. See [Canvas surfaces](#canvas-surfaces-the-map-and-charts).                                                              |
| `effects`       | no       | Which effects the theme draws: any of `scanlines`, `glow`, `crt`, `noise`, `flicker`. See [Effects](#effects).                                  |
| `minAppVersion` | no       | The oldest MeshTerm it's made for; older versions show a warning to admins.                                                                     |

Every path in the manifest is relative to the theme folder: `fonts/x.woff2`, not `./fonts/x.woff2`, `/fonts/x.woff2` or a URL. Every file it names must exist.

### What a theme may contain

Only these file types are served: `.css`, `.json`, `.woff2`, `.woff`, `.png`, `.svg`, `.webp`, `.jpg`, `.mp3`, `.ogg`, `.wav`. Anything else, including any `.js`, is never served. **Themes are CSS and assets only.**

Everything loads from MeshTerm itself. Browsers refuse fonts, images and stylesheets from other sites (`url(https://…)`), and MeshTerm warns admins about them in the picker.

### When a theme is broken

A theme with a missing or invalid `theme.json`, an id that doesn't match its folder, or a manifest naming a file that isn't there is skipped. Admins see it in the picker as **Broken**, with the reason; everyone else doesn't see it at all.

If a theme makes MeshTerm unusable, add `?theme=default` to the address (for example `http://meshterm.local:8080/dashboard?theme=default`). That forces a theme for one page load without saving it, so you can get back to Settings and pick another one.

## Where to put it

| Where           | In the container     | Notes                                                                                       |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Built-in themes | `/app/themes/`       | Part of the image: Default (and later Retro Terminal and Cyberpunk). Updated with MeshTerm. |
| Your themes     | `/data/themes/<id>/` | Created on first start. Survives updates, because `/data` is your volume.                   |

- **Hot reload.** MeshTerm watches `/data/themes`. A new folder appears in the picker within about 2 seconds, and saving a theme's CSS restyles every browser using it, without a reload. On a network share (NFS, SMB) or some bind mounts, file events don't arrive: set `MESHTERM_THEMES_POLL=1` to check by polling instead.
- **Changing a built-in.** Don't edit built-ins in the image. Instead, as an admin, open **Settings → Appearance**, select the theme and press **Duplicate … as a user theme**: MeshTerm copies it to `/data/themes/<new-id>/` for you to edit. A user theme with the same id as a built-in replaces it, but only while it's valid; a broken copy never hides the built-in.
- **Who sees which theme.** Each browser remembers its own choice. Browsers that haven't chosen use the **server default theme**, which admins set in Settings → Appearance (it also styles the sign-in page).

## Your first theme in 10 minutes

1. **Copy Default.** In **Settings → Appearance** (as an admin), select Default and press **Duplicate Default as a user theme**. Call it `harbor`, named "Harbor". It's now selected, and its files are in `/data/themes/harbor/`.

   Without admin access to the UI, copy the folder instead: `docker compose cp meshterm:/app/themes/default ./harbor`, change `id` and `name` in `harbor/theme.json`, and copy it back with `docker compose cp ./harbor meshterm:/data/themes/harbor`.

2. **Make it dark only.** In `theme.json`, set `"colorScheme": "dark"` and update `preview` to the colors below.

3. **Change six tokens.** Open `/data/themes/harbor/theme.css` and replace its contents with:

   ```css
   @layer theme {
     :root {
       color-scheme: dark;
       --mt-surface-bg: #0d1b24;
       --mt-surface-raised: #13293a;
       --mt-border-color: #24475e;
       --mt-text: #e6f1f7;
       --mt-accent: #2ec4b6;
       --mt-bubble-out-bg: #1f7a8c;
     }
   }
   ```

   Save. Every browser showing Harbor changes at once. Tokens you don't set keep the values in MeshTerm's base styles, which derive many of them from the ones above (cards from surfaces, badges from the accent, and so on).

4. **Override one hook.** Make the active navigation item stand out, below the `:root` block, still inside `@layer theme`:

   ```css
   [data-mt="nav-item"][data-mt-state="active"] {
     border-inline-start: 3px solid var(--mt-accent);
     font-weight: var(--mt-font-weight-bold);
   }
   ```

5. **Check it.** Walk through Dashboard, Map, Messages, a node's details and Settings, in a desktop window and a narrow one. Go through the [accessibility checklist](#accessibility-checklist).

## How styling works

MeshTerm's CSS is in [cascade layers](https://developer.mozilla.org/docs/Web/CSS/@layer), declared once in this order:

```css
@layer reset, base, theme, overrides;
```

**Put everything in your theme inside `@layer theme { … }`.** Rules in the `theme` layer beat MeshTerm's `base` styles no matter how specific those are, so you never need `!important`.

You change MeshTerm in two ways:

- **Tokens** are CSS custom properties named `--mt-*`, set on `:root`. Components use only tokens for colors, fonts, sizes, radii and shadows, so changing a token changes everything that uses it. Start here. The [token reference](#token-reference) lists them all.
- **Hooks** are `data-mt` attributes on every meaningful element, so you can restyle a specific part: `[data-mt="toast"]`, `[data-mt="node-card"]`. Many also carry a runtime state (`data-mt-state`, for example `active`, `unread`, `failed`) and a static variant (`data-mt-variant`, for example `dm`, `channel`). The [hook reference](#hook-reference) lists them all.

Hooks are a public API: MeshTerm doesn't rename or remove them without calling it a breaking change. Class names and the HTML structure inside components can change, so don't rely on them.

`<html>` also tells you which theme and mode are showing: `data-mt-theme="<id>"` and `data-mt-mode="light"` or `"dark"`.

## Light and dark

- `"colorScheme": "dark"` or `"light"`: the theme has one look. The Mode setting in Settings → Appearance is greyed out for it.
- `"colorScheme": "auto"`: the theme has both, and follows the Mode setting: **System** (the device's light or dark setting, followed live), **Light** or **Dark**.

An `auto` theme styles each mode under `data-mt-mode`, as Default does:

```css
@layer theme {
  :root,
  :root:where([data-mt-mode="dark"]) {
    color-scheme: dark;
    --mt-surface-bg: #0b1018;
  }

  :root:where([data-mt-mode="light"]) {
    color-scheme: light;
    --mt-surface-bg: #f4f6f9;
  }
}
```

Putting the dark values on plain `:root` as well gives a complete palette even before a mode is set. Larger differences can go in separate files listed under `modes`, which load only in their mode. Set `color-scheme` in each mode so scrollbars and form controls match.

## Canvas surfaces: the map and charts

The map page and the telemetry charts draw on a canvas, which CSS can't style. MeshTerm reads their colors from tokens instead, and reads them again whenever the theme or mode changes:

- **Map:** `--mt-map-node-online` / `-recent` / `-stale` / `-offline` (dots), `--mt-map-label`, `--mt-map-label-halo`, `--mt-map-cluster-bg`, `--mt-map-cluster-text`, `--mt-font-map`.
- **Charts:** `--mt-chart-1` … `--mt-chart-6` (series), `--mt-chart-grid`, `--mt-chart-axis`, `--mt-chart-crosshair`, `--mt-chart-band-alpha`, `--mt-chart-threshold-warn` / `-danger`, `--mt-chart-powered`, `--mt-chart-reboot`.

Any CSS color works (`#hex`, `rgb()`, `oklch()`, `var(--mt-accent)`, `color-mix()`). Sparklines and the mini maps on node cards are SVG and HTML: they follow tokens directly, and mini-map tiles can be restyled with `filter` on `[data-mt="mini-map-tiles"]`.

The base map's look (the OpenStreetMap tiles) can't be changed by a theme yet; `mapStyle` is accepted in the manifest for when it can.

## Effects

Effects such as scanlines or a glow are drawn by the theme's CSS. The manifest's `effects` list says which ones a theme has, and the picker shows an **Effects** badge for it. The effects layer and its on/off switch are on the way; until then, keep effects subtle and inside `@media (prefers-reduced-motion: no-preference)` when they move.

## Fonts and sounds

**Fonts.** Bundle `.woff2` (or `.woff`) files in the theme folder and list them under `fonts`; MeshTerm loads them before switching, so text doesn't jump. Then use them through the font tokens:

```css
@layer theme {
  :root {
    --mt-font-display: "Orbitron", var(--mt-font-body);
  }
}
```

`--mt-font-body` is for all text, `--mt-font-mono` for ids and numbers, and `--mt-font-display` for headings. You can also use `@font-face` in your CSS with a relative `url()`. Only bundle fonts whose license allows it (SIL Open Font License or Apache 2.0), and credit them in `LICENSES.md`.

**Sounds.** List replacement notification sounds under `sounds`: `message` (DMs), `mention` (mentions and replies) and `channel` (channel messages). Keep them short (under a second) and quiet. A theme without sounds uses MeshTerm's own.

## Accessibility checklist

- [ ] Text has a contrast of at least **4.5:1** against its background (3:1 for large text and icons). Check muted text, text on the accent, bubbles, badges and toasts, in every mode the theme has.
- [ ] Focus is clearly visible on every button, link, input and card (`:focus-visible` uses `--mt-accent` unless you style it).
- [ ] Nothing moves under `prefers-reduced-motion: reduce`. MeshTerm sets `--mt-duration-*` to 0 there; use those tokens for your transitions, and wrap your own animations in `@media (prefers-reduced-motion: no-preference)`.
- [ ] Status isn't told by color alone. Online / stale / offline, delivery states and warnings already have icons or text; don't hide them.
- [ ] It works at 390 px wide as well as on a desktop.
- [ ] Effects never lower the contrast of text below the levels above.

## Token reference

Every token, with Default's values in dark and light, the value without any theme (CSS system colors), and what uses it.

<!-- tokens:start (generated by pnpm docs:tokens; don't edit by hand) -->

### Surface

Page and panel backgrounds, borders.

| Token                   | Default (dark)     | Default (light)        | Without a theme            | Used for                             |
| ----------------------- | ------------------ | ---------------------- | -------------------------- | ------------------------------------ |
| `--mt-surface-bg`       | `#0b1018`          | `#f4f6f9`              | `Canvas`                   | the page background                  |
| `--mt-surface-raised`   | `#161f2c`          | `#fff`                 | `Canvas`                   | panels, cards, inputs                |
| `--mt-surface-sunken`   | `#0e141e`          | `#eceef2`              | `Canvas`                   | wells: code, raw JSON, table stripes |
| `--mt-surface-elevated` | `#1d2938`          | `#fff`                 | `var(--mt-surface-raised)` | popovers, menus, dialogs             |
| `--mt-sidebar-bg`       | `#111823`          | `#fff`                 | `var(--mt-surface-raised)` | the navigation sidebar               |
| `--mt-border-color`     | `#2a3545`          | `#d5d9e0`              | `GrayText`                 | borders and dividers everywhere      |
| `--mt-shadow-popover`   | `0 8px 24px #0006` | `0 8px 24px #1b1f2729` | `none`                     | menus, popovers, dialogs             |

### Text

| Token               | Default (dark) | Default (light) | Without a theme | Used for                       |
| ------------------- | -------------- | --------------- | --------------- | ------------------------------ |
| `--mt-text`         | `#e8eef5`      | `#1b1f27`       | `CanvasText`    | body text                      |
| `--mt-text-muted`   | `#93a2b7`      | `#5d6675`       | `GrayText`      | secondary text, labels, axes   |
| `--mt-text-inverse` | `#0b1018`      | `#fff`          | `Canvas`        | text on accent or status fills |

### Accent and status

Links, focus, primary buttons; ok / warn / error / info.

| Token               | Default (dark) | Default (light) | Without a theme   | Used for                                         |
| ------------------- | -------------- | --------------- | ----------------- | ------------------------------------------------ |
| `--mt-accent`       | `#55a8ff`      | `#2563eb`       | `AccentColor`     | links, focus rings, active tabs, primary buttons |
| `--mt-accent-text`  | `#0b1018`      | `#fff`          | `AccentColorText` | text on the accent                               |
| `--mt-status-ok`    | `#35d49a`      | `#15803d`       | `AccentColor`     | connected, acked, good battery                   |
| `--mt-status-warn`  | `#f5b84b`      | `#b45309`       | `Mark`            | warnings, stale                                  |
| `--mt-status-error` | `#f16d79`      | `#b91c1c`       | `LinkText`        | errors, failed messages, danger                  |
| `--mt-status-info`  | `#55a8ff`      | `#2563eb`       | `AccentColor`     | information                                      |

### Message bubbles

| Token                  | Default (dark) | Default (light) | Without a theme   | Used for          |
| ---------------------- | -------------- | --------------- | ----------------- | ----------------- |
| `--mt-bubble-in-bg`    | `#1d2938`      | `#eceef2`       | `Field`           | received messages |
| `--mt-bubble-in-text`  | `#e8eef5`      | `#1b1f27`       | `FieldText`       |                   |
| `--mt-bubble-out-bg`   | `#2b6fbf`      | `#2563eb`       | `AccentColor`     | sent messages     |
| `--mt-bubble-out-text` | `#fff`         | `#fff`          | `AccentColorText` |                   |

### Badges and mentions

Unread counts (CR-003).

| Token                    | Default (dark) | Default (light) | Without a theme          | Used for                         |
| ------------------------ | -------------- | --------------- | ------------------------ | -------------------------------- |
| `--mt-badge-bg`          | —              | —               | `var(--mt-accent)`       | unread count badges, favicon dot |
| `--mt-badge-text`        | —              | —               | `var(--mt-accent-text)`  |                                  |
| `--mt-badge-priority-bg` | —              | —               | `var(--mt-status-error)` | badges with a DM or mention      |
| `--mt-mention-text`      | —              | —               | `inherit`                |                                  |

### Toasts

Notification popups (CR-003).

| Token               | Default (dark) | Default (light) | Without a theme              | Used for                            |
| ------------------- | -------------- | --------------- | ---------------------------- | ----------------------------------- |
| `--mt-toast-bg`     | —              | —               | `var(--mt-surface-elevated)` |                                     |
| `--mt-toast-border` | —              | —               | `var(--mt-border-color)`     |                                     |
| `--mt-toast-shadow` | —              | —               | `var(--mt-shadow-popover)`   |                                     |
| `--mt-toast-width`  | —              | —               | `22rem`                      |                                     |
| `--mt-toast-enter`  | —              | —               | `mt-toast-enter`             | animation name; `none` turns it off |
| `--mt-toast-exit`   | —              | —               | `none`                       | animation name                      |

### Cards

Dashboard and node cards.

| Token                   | Default (dark) | Default (light)       | Without a theme            | Used for                               |
| ----------------------- | -------------- | --------------------- | -------------------------- | -------------------------------------- |
| `--mt-card-bg`          | `#161f2c`      | `#fff`                | `var(--mt-surface-raised)` |                                        |
| `--mt-card-border`      | `#2a3545`      | `#d5d9e0`             | `var(--mt-border-color)`   |                                        |
| `--mt-card-radius`      | `0.625rem`     | `0.625rem`            | `var(--mt-radius-md)`      |                                        |
| `--mt-card-shadow`      | `none`         | `0 1px 2px #1b1f2714` | `none`                     |                                        |
| `--mt-card-self-accent` | `#55a8ff`      | `#2563eb`             | `var(--mt-accent)`         | the edge of your own node's card       |
| `--mt-card-min-width`   | —              | —                     | `17.5rem`                  | the card grid's column width           |
| `--mt-battery-low`      | `#f5b84b`      | `#b45309`             | `var(--mt-status-warn)`    | battery meters below the warning level |
| `--mt-battery-critical` | `#f16d79`      | `#b91c1c`             | `var(--mt-status-error)`   | battery meters below the danger level  |

### Signal

How recently a node was heard (status dots).

| Token                 | Default (dark) | Default (light) | Without a theme         | Used for |
| --------------------- | -------------- | --------------- | ----------------------- | -------- |
| `--mt-signal-online`  | `#35d49a`      | `#16a34a`       | `var(--mt-status-ok)`   |          |
| `--mt-signal-recent`  | `#55a8ff`      | `#2563eb`       | `var(--mt-status-info)` |          |
| `--mt-signal-stale`   | `#f5b84b`      | `#d97706`       | `var(--mt-status-warn)` |          |
| `--mt-signal-offline` | `#5b6878`      | `#9ca3af`       | `var(--mt-text-muted)`  |          |

### Charts

Sparklines, dashboard charts and telemetry charts (canvas: read through chart-tokens.ts).

| Token                         | Default (dark) | Default (light) | Without a theme                                               | Used for                                            |
| ----------------------------- | -------------- | --------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `--mt-chart-1`                | `#55a8ff`      | `#2563eb`       | `var(--mt-accent)`                                            | first series; sparklines                            |
| `--mt-chart-2`                | `#35d49a`      | `#15803d`       | `var(--mt-status-ok)`                                         |                                                     |
| `--mt-chart-3`                | `#a78bfa`      | `#7c3aed`       | `var(--mt-accent)`                                            |                                                     |
| `--mt-chart-4`                | `#f472b6`      | `#db2777`       | `var(--mt-status-warn)`                                       |                                                     |
| `--mt-chart-5`                | `#5b6878`      | `#9ca3af`       | `var(--mt-text-muted)`                                        | "other" in packet-type charts                       |
| `--mt-chart-6`                | `#f5b84b`      | `#b45309`       | `var(--mt-status-info)`                                       |                                                     |
| `--mt-chart-grid`             | —              | —               | `color-mix(in srgb, var(--mt-border-color) 60%, transparent)` |                                                     |
| `--mt-chart-axis`             | —              | —               | `var(--mt-text-muted)`                                        |                                                     |
| `--mt-chart-crosshair`        | —              | —               | `var(--mt-text-muted)`                                        |                                                     |
| `--mt-chart-band-alpha`       | —              | —               | `0.2`                                                         | opacity of min–max bands and the Powered band (0–1) |
| `--mt-chart-threshold-warn`   | —              | —               | `var(--mt-status-warn)`                                       |                                                     |
| `--mt-chart-threshold-danger` | —              | —               | `var(--mt-status-error)`                                      |                                                     |
| `--mt-chart-powered`          | —              | —               | `var(--mt-status-ok)`                                         | external power band                                 |
| `--mt-chart-reboot`           | —              | —               | `var(--mt-status-warn)`                                       | reboot markers                                      |

### Mini maps

The static maps on node cards.

| Token                  | Default (dark) | Default (light) | Without a theme          | Used for |
| ---------------------- | -------------- | --------------- | ------------------------ | -------- |
| `--mt-mini-map-height` | —              | —               | `10rem`                  |          |
| `--mt-map-marker`      | `#55a8ff`      | `#2563eb`       | `var(--mt-accent)`       |          |
| `--mt-map-marker-self` | `#f16d79`      | `#db2777`       | `var(--mt-status-error)` |          |

### Map page

Dots, labels and clusters (canvas: read through map-tokens.ts).

| Token                   | Default (dark) | Default (light) | Without a theme            | Used for               |
| ----------------------- | -------------- | --------------- | -------------------------- | ---------------------- |
| `--mt-map-node-online`  | —              | —               | `var(--mt-signal-online)`  |                        |
| `--mt-map-node-recent`  | —              | —               | `var(--mt-signal-recent)`  |                        |
| `--mt-map-node-stale`   | —              | —               | `var(--mt-signal-stale)`   |                        |
| `--mt-map-node-offline` | —              | —               | `var(--mt-signal-offline)` |                        |
| `--mt-map-label`        | —              | —               | `var(--mt-text)`           |                        |
| `--mt-map-label-halo`   | —              | —               | `var(--mt-surface-bg)`     |                        |
| `--mt-map-cluster-bg`   | —              | —               | `var(--mt-accent)`         |                        |
| `--mt-map-cluster-text` | —              | —               | `var(--mt-accent-text)`    |                        |
| `--mt-font-map`         | —              | —               | `var(--mt-font-body)`      | node labels on the map |

### Device settings

Staged, conflicting and dangerous changes; QR codes.

| Token                    | Default (dark) | Default (light) | Without a theme                                               | Used for                                        |
| ------------------------ | -------------- | --------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `--mt-field-changed-bg`  | —              | —               | `color-mix(in srgb, var(--mt-accent) 12%, transparent)`       |                                                 |
| `--mt-field-conflict-bg` | —              | —               | `color-mix(in srgb, var(--mt-status-warn) 18%, transparent)`  |                                                 |
| `--mt-danger-surface`    | —              | —               | `color-mix(in srgb, var(--mt-status-error) 12%, transparent)` |                                                 |
| `--mt-qr-fg`             | `#000`         | `#000`          | `CanvasText`                                                  | keep QR codes dark on light: scanners expect it |
| `--mt-qr-bg`             | `#fff`         | `#fff`          | `Canvas`                                                      |                                                 |

### Typography

| Token                     | Default (dark) | Default (light) | Without a theme           | Used for                                        |
| ------------------------- | -------------- | --------------- | ------------------------- | ----------------------------------------------- |
| `--mt-font-body`          | —              | —               | `system-ui, sans-serif`   |                                                 |
| `--mt-font-mono`          | —              | —               | `ui-monospace, monospace` | ids, numbers, raw data                          |
| `--mt-font-display`       | —              | —               | `var(--mt-font-body)`     | headings: page titles, section and card headers |
| `--mt-font-size-xs`       | —              | —               | `0.75rem`                 |                                                 |
| `--mt-font-size-sm`       | —              | —               | `0.875rem`                |                                                 |
| `--mt-font-size-md`       | —              | —               | `1rem`                    |                                                 |
| `--mt-font-size-lg`       | —              | —               | `1.25rem`                 |                                                 |
| `--mt-font-size-xl`       | —              | —               | `1.625rem`                |                                                 |
| `--mt-font-weight-medium` | —              | —               | `500`                     |                                                 |
| `--mt-font-weight-bold`   | —              | —               | `600`                     |                                                 |
| `--mt-line-height`        | —              | —               | `1.5`                     |                                                 |

### Shape

| Token               | Default (dark) | Default (light) | Without a theme | Used for |
| ------------------- | -------------- | --------------- | --------------- | -------- |
| `--mt-radius-sm`    | —              | —               | `0.25rem`       |          |
| `--mt-radius-md`    | —              | —               | `0.5rem`        |          |
| `--mt-radius-lg`    | —              | —               | `1rem`          |          |
| `--mt-border-width` | —              | —               | `1px`           |          |

### Spacing

| Token          | Default (dark) | Default (light) | Without a theme | Used for |
| -------------- | -------------- | --------------- | --------------- | -------- |
| `--mt-space-1` | —              | —               | `0.25rem`       |          |
| `--mt-space-2` | —              | —               | `0.5rem`        |          |
| `--mt-space-3` | —              | —               | `1rem`          |          |
| `--mt-space-4` | —              | —               | `1.5rem`        |          |

### Layout

| Token                          | Default (dark) | Default (light) | Without a theme    | Used for                     |
| ------------------------------ | -------------- | --------------- | ------------------ | ---------------------------- |
| `--mt-header-height`           | —              | —               | `3rem`             |                              |
| `--mt-tab-bar-height`          | —              | —               | `3.5rem`           |                              |
| `--mt-sidebar-width`           | —              | —               | `14rem`            |                              |
| `--mt-sidebar-collapsed-width` | —              | —               | `4rem`             |                              |
| `--mt-conversation-list-width` | —              | —               | `20rem`            |                              |
| `--mt-drawer-width`            | —              | —               | `min(18rem, 85vw)` | the mobile navigation drawer |

### Node drawer

Node details (CR-001).

| Token                    | Default (dark) | Default (light) | Without a theme            | Used for                                      |
| ------------------------ | -------------- | --------------- | -------------------------- | --------------------------------------------- |
| `--mt-node-drawer-width` | —              | —               | `30rem`                    | from 768 px; users can resize it (400–800 px) |
| `--mt-drawer-bg`         | —              | —               | `var(--mt-sidebar-bg)`     |                                               |
| `--mt-drawer-shadow`     | —              | —               | `var(--mt-shadow-popover)` |                                               |

### Motion

0 under prefers-reduced-motion.

| Token                  | Default (dark) | Default (light) | Without a theme              | Used for |
| ---------------------- | -------------- | --------------- | ---------------------------- | -------- |
| `--mt-duration-fast`   | —              | —               | `120ms`                      |          |
| `--mt-duration-normal` | —              | —               | `200ms`                      |          |
| `--mt-easing`          | —              | —               | `cubic-bezier(0.2, 0, 0, 1)` |          |

<!-- tokens:end -->

## Hook reference

Every `data-mt` hook, grouped by where it appears. "From data" means the value comes from what's shown (a node's status, a message's kind) and can take values beyond the ones listed.

<!-- hooks:start (generated by pnpm docs:tokens; don't edit by hand) -->

### Dashboard and nodes

| `data-mt`               | Element                                                  | `data-mt-state`                                                  | `data-mt-variant`                                                                                             |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `activity-error`        |                                                          |                                                                  |                                                                                                               |
| `activity-feed`         | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-icon`         | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-item`         | Activity feed                                            |                                                                  | (from data)                                                                                                   |
| `activity-main`         | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-more`         | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-scroll`       | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-source`       | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-text`         | Activity feed                                            |                                                                  |                                                                                                               |
| `activity-time`         | Activity feed                                            |                                                                  |                                                                                                               |
| `attention-item`        | Attention needed                                         | `danger`, `warn`, … (from data)                                  | `air-util-tx`, `battery`, `channel-util`, `quiet-favorite`, … (from data)                                     |
| `attention-list`        | Attention needed                                         |                                                                  |                                                                                                               |
| `attention-node`        | Attention needed                                         |                                                                  |                                                                                                               |
| `attention-text`        | Attention needed                                         |                                                                  |                                                                                                               |
| `battery-meter`         | Battery bar (`--mt-battery-fill`)                        | `critical`, `low`, `ok`, `powered`, `unknown`, … (from data)     |                                                                                                               |
| `battery-meter-fill`    | Battery bar (`--mt-battery-fill`)                        |                                                                  |                                                                                                               |
| `busiest-node`          | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `busiest-node-count`    | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `busiest-node-name`     | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `busiest-nodes`         | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `busiest-nodes-list`    | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `busiest-nodes-title`   | Busiest nodes list                                       |                                                                  |                                                                                                               |
| `card-cell`             | Card grid (`ul`) and cell (`li`)                         |                                                                  |                                                                                                               |
| `card-grid`             | Card grid (`ul`) and cell (`li`)                         |                                                                  | `probe`                                                                                                       |
| `card-section`          | Section wrapper and one section                          |                                                                  | `all`, `favorites`, `self`, `virtual`, … (from data)                                                          |
| `card-section-count`    | Section heading and count                                |                                                                  |                                                                                                               |
| `card-section-title`    | Section heading and count                                |                                                                  | `all`, `favorites`, `self`, … (from data)                                                                     |
| `card-sections`         | Section wrapper and one section                          |                                                                  | `virtual`                                                                                                     |
| `chart-error`           |                                                          |                                                                  |                                                                                                               |
| `connection-duration`   | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `dashboard`             | Dashboard page                                           | `error`, `loading`, `ready`                                      |                                                                                                               |
| `dashboard-column`      |                                                          |                                                                  | `main`, `side`                                                                                                |
| `dashboard-density`     | Toolbar controls                                         |                                                                  | `segmented`                                                                                                   |
| `dashboard-empty`       | Loading, error, no nodes yet, nothing matches            |                                                                  |                                                                                                               |
| `dashboard-error`       | Loading, error, no nodes yet, nothing matches            |                                                                  |                                                                                                               |
| `dashboard-filter`      | Toolbar controls                                         |                                                                  | `segmented`                                                                                                   |
| `dashboard-grid`        | Dashboard grid and its panels                            |                                                                  |                                                                                                               |
| `dashboard-last-packet` | Last packet in the dashboard header                      |                                                                  |                                                                                                               |
| `dashboard-no-match`    | Loading, error, no nodes yet, nothing matches            |                                                                  |                                                                                                               |
| `dashboard-search`      | Nodes page toolbar                                       |                                                                  |                                                                                                               |
| `dashboard-sort`        | Toolbar controls                                         |                                                                  | `segmented`, `select`                                                                                         |
| `dashboard-waiting`     | Loading, error, no nodes yet, nothing matches            |                                                                  |                                                                                                               |
| `kpi-row`               | KPI cards (`section`)                                    |                                                                  |                                                                                                               |
| `last-packet`           | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card`           | One KPI                                                  | `danger`, `ok`, `unknown`, `warn`, … (from data)                 | `air-util-tx`, `channel-util`, `connection`, `messages`, `my-power`, `network-nodes`, … (from data)           |
| `metric-card-bottom`    | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-icon`      | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-label`     | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-secondary` | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-top`       | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-unit`      | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-card-value`     | Parts of a KPI                                           |                                                                  |                                                                                                               |
| `metric-row`            | One `dt`/`dd` row                                        |                                                                  | `air-util-tx`, `channel-util`, `environment`, `hops`, `last-seen`, `power`, `signal`, `uptime`, … (from data) |
| `metric-value`          | Text next to the battery meter                           |                                                                  |                                                                                                               |
| `mini-map`              | Map box                                                  | `empty`, `ready`                                                 | `node`, `self`                                                                                                |
| `mini-map-link`         | Covers a mini map; opens `/map?focus=`                   |                                                                  |                                                                                                               |
| `mini-map-marker`       | Tile mosaic, pin, precision circle, "No position shared" |                                                                  |                                                                                                               |
| `mini-map-placeholder`  | Tile mosaic, pin, precision circle, "No position shared" |                                                                  |                                                                                                               |
| `mini-map-precision`    | Tile mosaic, pin, precision circle, "No position shared" |                                                                  |                                                                                                               |
| `mini-map-tiles`        | Tile mosaic, pin, precision circle, "No position shared" |                                                                  |                                                                                                               |
| `network-caption`       | Network overview                                         |                                                                  |                                                                                                               |
| `network-disk`          |                                                          |                                                                  |                                                                                                               |
| `network-error`         | Network overview                                         |                                                                  |                                                                                                               |
| `network-focus`         | Network overview                                         |                                                                  |                                                                                                               |
| `network-hidden`        | Network overview                                         |                                                                  |                                                                                                               |
| `network-hover-label`   |                                                          |                                                                  |                                                                                                               |
| `network-legend`        | Network overview                                         |                                                                  |                                                                                                               |
| `network-legend-item`   | Network overview                                         |                                                                  | `direct`, `reported`, `router`                                                                                |
| `network-link`          | Network overview                                         | `fair`, `good`, `poor`, `unknown`, `weak`, … (from data)         | `direct`, `favorite`, `many`, `one`, `reported`, `router`, `self`, … (from data)                              |
| `network-map`           | Network overview                                         |                                                                  |                                                                                                               |
| `network-node`          | Network overview                                         | `fair`, `good`, `poor`, `unknown`, `weak`, … (from data)         | `direct`, `favorite`, `many`, `one`, `reported`, `router`, `self`, … (from data)                              |
| `network-ring`          | Network overview                                         |                                                                  | `direct`, `favorite`, `many`, `one`, `reported`, `router`, `self`, … (from data)                              |
| `node-battery`          | Node table cell: battery                                 |                                                                  |                                                                                                               |
| `node-card`             | One node card (`article`, focusable)                     | `offline`, `online`, `recent`, `stale`, `updated`, … (from data) | `favorite`, `self`, … (from data)                                                                             |
| `node-card-actions`     | Card parts                                               |                                                                  |                                                                                                               |
| `node-card-body`        | Card parts                                               |                                                                  |                                                                                                               |
| `node-card-header`      | Card parts                                               |                                                                  |                                                                                                               |
| `node-card-meta`        | Card parts                                               |                                                                  |                                                                                                               |
| `node-cards`            | Card view wrapper on the Nodes page                      |                                                                  | `comfy`, `compact`, … (from data)                                                                             |
| `node-channelUtil`      | Node table cell: channelUtil                             |                                                                  |                                                                                                               |
| `node-distance`         | Node table cell: distance                                |                                                                  |                                                                                                               |
| `node-dm-link`          | Node table: a node's name, linking to its DM             |                                                                  |                                                                                                               |
| `node-hardware`         | Node table cell: hardware                                |                                                                  |                                                                                                               |
| `node-hops`             | Node table cell: hops                                    |                                                                  |                                                                                                               |
| `node-lastHeard`        | Node table cell: lastHeard                               |                                                                  |                                                                                                               |
| `node-list`             | Nodes page                                               |                                                                  | `cards`, `table`, … (from data)                                                                               |
| `node-list-waiting`     | Before nodes load                                        |                                                                  |                                                                                                               |
| `node-long-name`        | Names, hardware label, distance/bearing/altitude line    |                                                                  |                                                                                                               |
| `node-place`            | Names, hardware label, distance/bearing/altitude line    |                                                                  |                                                                                                               |
| `node-preview`          | Node previews on the dashboard                           | `updated`, … (from data)                                         | `favorite`, `self`, … (from data)                                                                             |
| `node-preview-actions`  | Parts of a preview                                       |                                                                  |                                                                                                               |
| `node-preview-header`   | Parts of a preview                                       |                                                                  |                                                                                                               |
| `node-preview-meta`     | Parts of a preview                                       |                                                                  |                                                                                                               |
| `node-preview-stats`    | Parts of a preview                                       |                                                                  |                                                                                                               |
| `node-role`             | Node table cell: role                                    |                                                                  |                                                                                                               |
| `node-rssi`             | Node table cell: rssi                                    |                                                                  |                                                                                                               |
| `node-short`            | Node table cell: short                                   |                                                                  |                                                                                                               |
| `node-snr`              | Node table cell: snr                                     |                                                                  |                                                                                                               |
| `node-table-head`       | Node table: the header row                               |                                                                  |                                                                                                               |
| `node-voltage`          | Node table cell: voltage                                 |                                                                  |                                                                                                               |
| `nodes-toolbar`         | Nodes page toolbar                                       |                                                                  |                                                                                                               |
| `nodes-view`            | Toolbar controls                                         |                                                                  | `segmented`                                                                                                   |
| `not-found`             | Unknown route                                            |                                                                  |                                                                                                               |
| `panel-hint`            | Dashboard grid and its panels                            |                                                                  |                                                                                                               |
| `panel-link`            | Dashboard grid and its panels                            |                                                                  |                                                                                                               |
| `power-filter`          | Toolbar controls                                         |                                                                  | `segmented`, `select`                                                                                         |
| `preview-cell`          | Node previews on the dashboard                           |                                                                  |                                                                                                               |
| `preview-grid`          | Node previews on the dashboard                           |                                                                  |                                                                                                               |
| `preview-stat`          | Parts of a preview                                       |                                                                  | `distance`, `last-heard`, `power`, `signal`, `uptime`, … (from data)                                          |
| `role-badge`            | Role label                                               |                                                                  | (from data)                                                                                                   |
| `role-filter`           | Toolbar controls                                         |                                                                  | `segmented`, `select`                                                                                         |
| `select-label`          | Nodes page toolbar                                       |                                                                  |                                                                                                               |
| `self-badge`            | Parts of a preview                                       |                                                                  |                                                                                                               |
| `signal-bars`           | SNR bars (`rect` children `on`/`off`)                    | `fair`, `good`, `poor`, `unknown`, `weak`, … (from data)         |                                                                                                               |
| `sparkline`             | 24 h battery SVG                                         |                                                                  |                                                                                                               |
| `toolbar-row`           | Nodes page toolbar                                       |                                                                  |                                                                                                               |
| `traffic-controls`      | Traffic panel controls (view: `packets` / `messages`)    |                                                                  |                                                                                                               |
| `traffic-view`          | Traffic panel controls (view: `packets` / `messages`)    |                                                                  | `segmented`                                                                                                   |
| `traffic-window`        | Network activity: time window (1 h / 6 h / 24 h / 7 d)   |                                                                  | `segmented`                                                                                                   |
| `usage-bar`             | 0–100 bar (`--mt-usage`)                                 | `danger`, `ok`, `unknown`, `warn`, … (from data)                 |                                                                                                               |
| `usage-bar-fill`        | 0–100 bar (`--mt-usage`)                                 |                                                                  |                                                                                                               |
| `virtual-row`           | Virtualized grid canvas and row                          |                                                                  |                                                                                                               |
| `virtual-space`         | Virtualized grid canvas and row                          |                                                                  |                                                                                                               |

### Map

| `data-mt`              | Element                                           | `data-mt-state`                                           | `data-mt-variant` |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------- | ----------------- |
| `map-attribution`      | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-attribution-link` | The OpenStreetMap credit link                     |                                                           |                   |
| `map-button`           | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-canvas`           | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-error`            | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-popover`          | Node popup (anchor at the node, card above it)    |                                                           |                   |
| `map-popover-card`     | Node popup (anchor at the node, card above it)    |                                                           |                   |
| `map-popover-fields`   | Node popup (anchor at the node, card above it)    |                                                           |                   |
| `map-popover-header`   | Node popup (anchor at the node, card above it)    |                                                           |                   |
| `map-popover-title`    | Node popup (anchor at the node, card above it)    |                                                           |                   |
| `map-toolbar`          | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-unplaced`         | "Not on map (N)"                                  |                                                           |                   |
| `map-unplaced-list`    | "Not on map (N)"                                  |                                                           |                   |
| `map-unplaced-node`    | "Not on map (N)"                                  |                                                           |                   |
| `map-unplaced-seen`    | "Not on map (N)"                                  |                                                           |                   |
| `map-unplaced-toggle`  | "Not on map (N)"                                  |                                                           |                   |
| `map-unsupported`      | Map parts (attribution can't be hidden by themes) |                                                           |                   |
| `map-view`             | Map page                                          | `error`, `loading`, `ready`, `unsupported`, … (from data) |                   |

### Messages

| `data-mt`                    | Element                                                          | `data-mt-state`                                    | `data-mt-variant`                     |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `conversation-hash`          | Row parts                                                        |                                                    |                                       |
| `conversation-item`          |                                                                  |                                                    |                                       |
| `conversation-list`          | Conversation list and its toolbar                                |                                                    |                                       |
| `conversation-list-loading`  |                                                                  |                                                    |                                       |
| `conversation-long-name`     | Row parts                                                        |                                                    |                                       |
| `conversation-menu-button`   |                                                                  |                                                    |                                       |
| `conversation-meta`          |                                                                  |                                                    |                                       |
| `conversation-name`          | Row parts                                                        |                                                    |                                       |
| `conversation-preview`       | Row parts                                                        |                                                    |                                       |
| `conversation-preview-text`  | Row parts                                                        |                                                    |                                       |
| `conversation-row`           | One conversation (link)                                          | `active`, `idle`, `muted`, `unread`, … (from data) | `channel`, `dm`                       |
| `conversation-rows`          | A list section                                                   |                                                    |                                       |
| `conversation-search`        | Conversation list and its toolbar                                |                                                    |                                       |
| `conversation-section`       | A list section                                                   |                                                    | `channels`, `dms`                     |
| `conversation-section-empty` | A list section                                                   |                                                    |                                       |
| `conversation-section-title` | A list section                                                   |                                                    |                                       |
| `conversation-short-name`    | Row parts                                                        |                                                    |                                       |
| `conversation-time`          | Row parts                                                        |                                                    |                                       |
| `conversation-toolbar`       | Conversation list and its toolbar                                |                                                    |                                       |
| `encryption-badge`           | Encryption of the conversation                                   |                                                    | `channel`, `none`, `pki`              |
| `mention-marker`             |                                                                  |                                                    |                                       |
| `messages-view`              | Messages page                                                    | `list`, `thread`                                   |                                       |
| `new-dm-button`              | Conversation list and its toolbar                                |                                                    |                                       |
| `node-picker`                | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-empty`          | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-header`         | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-item`           | One node                                                         | `favorite`, `normal`                               |                                       |
| `node-picker-list`           | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-long`           | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-meta`           | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-names`          | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-search`         | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-short`          | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-title`          | New DM picker (dialog)                                           |                                                    |                                       |
| `node-picker-warning`        | Why a DM might not go as expected                                |                                                    | `no-key`, `quiet`, … (from data)      |
| `show-ignored`               |                                                                  |                                                    |                                       |
| `thread`                     | Thread pane and the open conversation                            |                                                    | `channel`, `dm`                       |
| `thread-back`                | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `thread-details`             | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `thread-empty`               | Thread pane and the open conversation                            |                                                    |                                       |
| `thread-header`              | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    | `channel`, `dm`                       |
| `thread-heading`             | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `thread-info`                | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `thread-pane`                | Thread pane and the open conversation                            |                                                    |                                       |
| `thread-pill`                | Channel role                                                     |                                                    | `primary`, `secondary`, … (from data) |
| `thread-subtitle`            | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `thread-title`               | Thread header (Back shows below 768 px; ⓘ opens the node drawer) |                                                    |                                       |
| `unread-badge`               |                                                                  |                                                    | `muted`                               |

### Node drawer

| `data-mt`               | Element                                                                                                   | `data-mt-state`      | `data-mt-variant`                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `chart-canvas`          | uPlot chart (`role=img` with a summary); themes may target `.u-*` inside                                  | `range`, `zoomed`    |                                                                                                             |
| `chart-group`           | One chart in a drawer tab                                                                                 | `empty`, `ready`     | `air-pm`, `battery`, `hops`, `packets`, `radio`, `rssi`, `snr`, `uptime`, `voltage`, … (from data)          |
| `chart-group-header`    | One chart in a drawer tab                                                                                 |                      |                                                                                                             |
| `chart-table`           | "View as table"                                                                                           |                      |                                                                                                             |
| `chart-table-toggle`    | One chart in a drawer tab                                                                                 |                      |                                                                                                             |
| `chart-table-wrap`      | "View as table"                                                                                           |                      |                                                                                                             |
| `chart-title`           | One chart in a drawer tab                                                                                 |                      |                                                                                                             |
| `copy-id`               | Drawer contents                                                                                           |                      |                                                                                                             |
| `detail-age`            | Drawer contents                                                                                           |                      |                                                                                                             |
| `detail-field`          | Drawer contents                                                                                           |                      | `environment`, `history`, `identity`, `in`, `location`, `messages`, `out`, `power`, `status`, … (from data) |
| `detail-fields`         | Drawer contents                                                                                           |                      |                                                                                                             |
| `detail-message`        | Drawer contents                                                                                           |                      | `environment`, `history`, `identity`, `in`, `location`, `messages`, `out`, `power`, `status`, … (from data) |
| `detail-message-text`   | Drawer contents                                                                                           |                      |                                                                                                             |
| `detail-messages`       | Drawer contents                                                                                           |                      |                                                                                                             |
| `detail-section`        | Drawer contents                                                                                           |                      | `environment`, `history`, `identity`, `in`, `location`, `messages`, `out`, `power`, `status`, … (from data) |
| `detail-section-title`  | Drawer contents                                                                                           |                      |                                                                                                             |
| `node-drawer`           | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-actions`   | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-body`      | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-header`    | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-names`     | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-panel`     | Node details drawer (CR-001)                                                                              |                      | `overview`, `raw`, `signal`, `telemetry`, … (from data)                                                     |
| `node-drawer-resize`    | Drag handle on the drawer's inner edge (from 768 px)                                                      |                      |                                                                                                             |
| `node-drawer-seen`      | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-short`     | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-subtitle`  | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-tab`       | Drawer tabs                                                                                               | `active`, `inactive` | `overview`, `raw`, `signal`, `telemetry`, … (from data)                                                     |
| `node-drawer-tabs`      | Drawer tabs                                                                                               |                      |                                                                                                             |
| `node-drawer-title`     | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `node-drawer-title-row` | Node details drawer (CR-001)                                                                              |                      |                                                                                                             |
| `range-custom`          | Telemetry/Signal range: presets (segmented `segment`s `1h`/`24h`/`7d`/`30d`/`custom`) and the custom form |                      |                                                                                                             |
| `range-picker`          | Telemetry/Signal range: presets (segmented `segment`s `1h`/`24h`/`7d`/`30d`/`custom`) and the custom form |                      |                                                                                                             |
| `range-presets`         | Telemetry/Signal range: presets (segmented `segment`s `1h`/`24h`/`7d`/`30d`/`custom`) and the custom form |                      | `segmented`                                                                                                 |
| `raw-json`              | Raw tab block (`<details>`)                                                                               |                      | `node`, `position`, … (from data)                                                                           |
| `raw-json-body`         | Raw tab block (`<details>`)                                                                               |                      |                                                                                                             |
| `raw-json-title`        | Raw tab block (`<details>`)                                                                               |                      |                                                                                                             |

### Notifications

| `data-mt`                    | Element | `data-mt-state` | `data-mt-variant` |
| ---------------------------- | ------- | --------------- | ----------------- |
| `dnd-indicator`              |         |                 |                   |
| `notification-bell`          |         | `dnd`           |                   |
| `notification-center`        |         |                 |                   |
| `notification-center-empty`  |         |                 |                   |
| `notification-center-header` |         |                 |                   |
| `notification-count`         |         |                 |                   |
| `notification-dot`           |         |                 |                   |
| `notification-item`          |         | `unread`        | (from data)       |
| `notification-list`          |         |                 |                   |
| `notification-preview`       |         |                 |                   |
| `notification-time`          |         |                 |                   |
| `notification-title`         |         |                 |                   |
| `permission-banner`          |         |                 |                   |
| `permission-banner-text`     |         |                 |                   |
| `thread-notify`              |         | (from data)     |                   |
| `toast-actions`              |         |                 |                   |
| `toast-body`                 |         |                 |                   |
| `toast-dot`                  |         |                 |                   |
| `toast-more`                 |         |                 |                   |
| `toast-open`                 |         |                 |                   |
| `toast-region`               |         |                 | (from data)       |
| `toast-reply`                |         |                 |                   |
| `toast-sent`                 |         |                 |                   |
| `toast-time`                 |         |                 |                   |
| `toast-title`                |         |                 |                   |

### Settings

| `data-mt`                 | Element                                                                                  | `data-mt-state`                          | `data-mt-variant`                                          |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `appearance-settings`     | Settings → Appearance (CR-004)                                                           |                                          |                                                            |
| `apply-progress`          |                                                                                          | (from data)                              |                                                            |
| `apply-step`              |                                                                                          | `active`, `done`, `pending`              |                                                            |
| `apply-steps`             |                                                                                          |                                          |                                                            |
| `apply-title`             |                                                                                          |                                          |                                                            |
| `audit-row`               | Users and audit tables                                                                   | `denied`, `failed`, `ok`, … (from data)  |                                                            |
| `audit-table`             | Users and audit tables                                                                   |                                          |                                                            |
| `backup-restore`          |                                                                                          |                                          |                                                            |
| `badge`                   | A small label on a theme card                                                            |                                          | `builtin`, `effects`, `override`, `user`                   |
| `channel-actions`         |                                                                                          |                                          |                                                            |
| `channel-link`            |                                                                                          |                                          |                                                            |
| `channel-list`            |                                                                                          |                                          |                                                            |
| `channel-manage`          |                                                                                          |                                          |                                                            |
| `channel-slot`            |                                                                                          | (from data)                              | (from data)                                                |
| `channel-slot-encryption` |                                                                                          | (from data)                              |                                                            |
| `channel-slot-index`      |                                                                                          |                                          |                                                            |
| `channel-slot-meta`       |                                                                                          |                                          |                                                            |
| `channel-slot-name`       |                                                                                          |                                          |                                                            |
| `channel-slot-role`       |                                                                                          |                                          |                                                            |
| `channels-editor`         |                                                                                          |                                          |                                                            |
| `check-row`               |                                                                                          |                                          | `setting`                                                  |
| `config-conflict`         |                                                                                          |                                          |                                                            |
| `config-connection`       |                                                                                          | `unknown`, … (from data)                 |                                                            |
| `config-connection-state` |                                                                                          |                                          |                                                            |
| `config-field`            |                                                                                          | (from data)                              | (from data)                                                |
| `config-field-head`       |                                                                                          |                                          |                                                            |
| `config-group`            |                                                                                          |                                          | `channel`, `dnd`, `quiet-hours`, `theme-admin`, `themes`   |
| `config-group-title`      |                                                                                          |                                          |                                                            |
| `config-header`           |                                                                                          |                                          |                                                            |
| `config-help`             |                                                                                          |                                          |                                                            |
| `config-input`            |                                                                                          |                                          |                                                            |
| `config-label`            |                                                                                          |                                          |                                                            |
| `config-layout`           |                                                                                          |                                          |                                                            |
| `config-lock`             |                                                                                          |                                          |                                                            |
| `config-nav`              |                                                                                          |                                          |                                                            |
| `config-nav-badge`        |                                                                                          |                                          |                                                            |
| `config-nav-heading`      |                                                                                          |                                          |                                                            |
| `config-nav-item`         |                                                                                          | (from data)                              | `danger`                                                   |
| `config-nav-summary`      |                                                                                          |                                          |                                                            |
| `config-nav-title`        |                                                                                          |                                          |                                                            |
| `config-section`          |                                                                                          |                                          |                                                            |
| `config-unit`             |                                                                                          |                                          |                                                            |
| `config-value`            |                                                                                          |                                          |                                                            |
| `config-value-text`       |                                                                                          |                                          |                                                            |
| `config-view`             |                                                                                          | `editable`, `read-only`                  |                                                            |
| `config-warning`          |                                                                                          |                                          | `desktop`                                                  |
| `danger-tag`              |                                                                                          |                                          | `lockout`, … (from data)                                   |
| `diff-arrow`              |                                                                                          |                                          |                                                            |
| `diff-from`               |                                                                                          |                                          |                                                            |
| `diff-note`               |                                                                                          |                                          |                                                            |
| `diff-row`                |                                                                                          | (from data)                              | (from data)                                                |
| `diff-to`                 |                                                                                          |                                          |                                                            |
| `dnd-status`              |                                                                                          |                                          |                                                            |
| `field-was`               |                                                                                          |                                          |                                                            |
| `inline-form`             |                                                                                          |                                          |                                                            |
| `maintenance`             |                                                                                          |                                          |                                                            |
| `maintenance-action`      |                                                                                          |                                          | `danger`                                                   |
| `maintenance-title`       |                                                                                          |                                          |                                                            |
| `map-picker`              |                                                                                          |                                          |                                                            |
| `map-picker-point`        |                                                                                          |                                          |                                                            |
| `mismatch-table`          |                                                                                          |                                          |                                                            |
| `mode-options`            | The mode buttons                                                                         |                                          | `segmented`                                                |
| `mode-toggle`             | Mode: System / Light / Dark (disabled for fixed-scheme themes)                           |                                          |                                                            |
| `pending-actions`         |                                                                                          |                                          |                                                            |
| `pending-summary`         |                                                                                          |                                          |                                                            |
| `pending-tray`            |                                                                                          |                                          |                                                            |
| `psk-field`               |                                                                                          | (from data)                              |                                                            |
| `psk-key`                 |                                                                                          |                                          |                                                            |
| `qr-code`                 |                                                                                          |                                          |                                                            |
| `reboot-tag`              |                                                                                          |                                          |                                                            |
| `recovery-panel`          |                                                                                          |                                          |                                                            |
| `review-address`          |                                                                                          |                                          |                                                            |
| `review-blocked`          |                                                                                          |                                          |                                                            |
| `review-section`          |                                                                                          |                                          |                                                            |
| `review-section-title`    |                                                                                          |                                          |                                                            |
| `review-table`            |                                                                                          |                                          |                                                            |
| `settings-body`           | Settings                                                                                 |                                          |                                                            |
| `settings-form`           | Settings                                                                                 |                                          | `wide`                                                     |
| `settings-nav`            | Settings                                                                                 |                                          |                                                            |
| `settings-nav-item`       | Settings                                                                                 | `active`, `inactive`                     |                                                            |
| `settings-section`        | Settings                                                                                 |                                          | `account`, `appearance`, `audit`, `notifications`, `users` |
| `settings-subtitle`       | Settings                                                                                 |                                          |                                                            |
| `settings-title`          | Settings                                                                                 |                                          |                                                            |
| `settings-view`           | Settings                                                                                 |                                          |                                                            |
| `snapshot-row`            |                                                                                          |                                          | (from data)                                                |
| `snapshot-table`          |                                                                                          |                                          |                                                            |
| `theme-card`              | One theme in the picker                                                                  | `active`, `broken`, `idle`, `previewing` | `builtin`, `override`, `user`                              |
| `theme-card-description`  | Theme description                                                                        |                                          |                                                            |
| `theme-card-meta`         | Author and version                                                                       |                                          |                                                            |
| `theme-card-name`         | Theme name                                                                               |                                          |                                                            |
| `theme-grid`              | The theme cards (radio group)                                                            |                                          |                                                            |
| `theme-swatch`            | A theme's preview colors (its manifest `preview`, as --mt-swatch-bg/surface/accent/text) |                                          |                                                            |
| `theme-swatch-accent`     | Swatch: the accent color                                                                 |                                          |                                                            |
| `theme-swatch-surface`    | Swatch: the surface color                                                                |                                          |                                                            |
| `theme-swatch-text`       | Swatch: the text color                                                                   |                                          |                                                            |
| `theming-guide-link`      | Link to the theming guide (THEMING.md)                                                   |                                          |                                                            |
| `typed-confirm`           |                                                                                          |                                          |                                                            |
| `typed-confirm-input`     |                                                                                          |                                          |                                                            |
| `user-actions`            | Users and audit tables                                                                   |                                          |                                                            |
| `user-row`                | Users and audit tables                                                                   |                                          | (from data)                                                |
| `user-self`               | Users and audit tables                                                                   |                                          |                                                            |
| `users-table`             | Users and audit tables                                                                   |                                          |                                                            |

### Shared

| `data-mt`              | Element                                                              | `data-mt-state`                                                | `data-mt-variant`                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-error`           | Sign-in / first-run setup / server-unreachable screens               |                                                                |                                                                                                                                                       |
| `auth-hint`            | Sign-in / first-run setup / server-unreachable screens               |                                                                |                                                                                                                                                       |
| `brand-icon`           | Parts of the brand                                                   |                                                                |                                                                                                                                                       |
| `button`               | Header reconnect, card Details                                       |                                                                | `danger`, `danger-primary`, `details`, `duplicate-theme`, `export-csv`, `file`, `message`, `primary`, `reconnect`, `request-telemetry`, `show-on-map` |
| `byte-counter`         | `bytes/200`                                                          | `ok`, `over`, `warn`                                           |                                                                                                                                                       |
| `cell-battery`         | Table cells                                                          |                                                                |                                                                                                                                                       |
| `chart`                | Time chart parts (`--mt-chart-x`, `--mt-series`)                     | `empty`, `ready`                                               |                                                                                                                                                       |
| `chart-axis`           | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`                                                                                                                                       |
| `chart-bar`            | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`, … (from data)                                                                                                                        |
| `chart-body`           | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-dot`            | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`, … (from data)                                                                                                                        |
| `chart-empty`          | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`, … (from data)                                                                                                                        |
| `chart-grid`           | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-guide`          | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-legend`         | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-legend-item`    | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`, … (from data)                                                                                                                        |
| `chart-line`           | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`, … (from data)                                                                                                                        |
| `chart-plot`           | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-swatch`         | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-times`          | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                |                                                                                                                                                       |
| `chart-tooltip`        | Time chart parts (`--mt-chart-x`, `--mt-series`)                     |                                                                | `left`, `right`                                                                                                                                       |
| `chart-tooltip-row`    | Chart tooltip: one series row                                        |                                                                |                                                                                                                                                       |
| `chart-tooltip-time`   | Chart tooltip: the time row                                          |                                                                |                                                                                                                                                       |
| `column-option`        | Table column chooser                                                 |                                                                |                                                                                                                                                       |
| `column-picker`        | Table column chooser                                                 |                                                                |                                                                                                                                                       |
| `column-picker-button` | Table column chooser                                                 |                                                                |                                                                                                                                                       |
| `column-picker-menu`   | Table column chooser                                                 |                                                                |                                                                                                                                                       |
| `composer`             | Send form                                                            | `disabled`, `error`, `ready`, `sending`, … (from data)         |                                                                                                                                                       |
| `composer-error`       | Send error; why sending is off                                       |                                                                |                                                                                                                                                       |
| `composer-hint`        | Send error; why sending is off                                       |                                                                | `viewer`                                                                                                                                              |
| `composer-input`       | Textarea and button                                                  |                                                                |                                                                                                                                                       |
| `config-error`         |                                                                      |                                                                |                                                                                                                                                       |
| `conversation`         | List + composer of one conversation                                  |                                                                | `channel`, `dm`                                                                                                                                       |
| `conversation-menu`    |                                                                      |                                                                |                                                                                                                                                       |
| `conversation-waiting` | Shown before a connection is known                                   |                                                                |                                                                                                                                                       |
| `detail-note`          | Drawer contents                                                      |                                                                |                                                                                                                                                       |
| `drawer-overlay`       | Mobile navigation drawer (Radix Dialog) and its parts                |                                                                |                                                                                                                                                       |
| `empty-state`          | Empty and loading placeholders                                       |                                                                |                                                                                                                                                       |
| `empty-state-text`     | Empty and loading placeholders                                       |                                                                |                                                                                                                                                       |
| `empty-state-title`    | Empty and loading placeholders                                       |                                                                |                                                                                                                                                       |
| `favorite-toggle`      | ★ button                                                             | `off`, `on`                                                    |                                                                                                                                                       |
| `history-start`        | Empty state; "start of conversation" marker                          |                                                                |                                                                                                                                                       |
| `icon`                 | Inline SVG icon (`currentColor`)                                     |                                                                | `favorite`, `muted`, `pki`                                                                                                                            |
| `icon-button`          | Mobile navigation drawer (Radix Dialog) and its parts                |                                                                |                                                                                                                                                       |
| `info-tip`             | Metric explanations                                                  |                                                                |                                                                                                                                                       |
| `info-tip-button`      | Metric explanations                                                  |                                                                |                                                                                                                                                       |
| `info-tip-text`        | Metric explanations                                                  |                                                                |                                                                                                                                                       |
| `mention`              |                                                                      |                                                                |                                                                                                                                                       |
| `menu-check`           |                                                                      |                                                                |                                                                                                                                                       |
| `menu-item`            | ⋯ menu (Radix DropdownMenu; highlighted item has `data-highlighted`) |                                                                | `danger`, `radio`, `sign-out`                                                                                                                         |
| `menu-label`           | Header account menu                                                  |                                                                |                                                                                                                                                       |
| `menu-separator`       |                                                                      |                                                                |                                                                                                                                                       |
| `message`              | One message bubble                                                   | `acked`, `failed`, `queued`, `received`, `sent`, … (from data) | `in`, `out`, … (from data)                                                                                                                            |
| `message-list`         | Scrolling, virtualized list (`role="log"`)                           | `empty`, `loading`, `ready`, … (from data)                     |                                                                                                                                                       |
| `message-list-canvas`  | Virtualizer canvas and row wrapper                                   |                                                                |                                                                                                                                                       |
| `message-list-empty`   | Empty state; "start of conversation" marker                          |                                                                |                                                                                                                                                       |
| `message-meta`         | Parts of a message                                                   |                                                                |                                                                                                                                                       |
| `message-row`          | Virtualizer canvas and row wrapper                                   |                                                                |                                                                                                                                                       |
| `message-sender`       | Parts of a message                                                   |                                                                |                                                                                                                                                       |
| `message-status`       | Outbound status text                                                 | (from data)                                                    | `relayed`                                                                                                                                             |
| `message-text`         | Parts of a message                                                   |                                                                |                                                                                                                                                       |
| `message-time`         | Parts of a message                                                   |                                                                |                                                                                                                                                       |
| `nav-badge`            |                                                                      | `priority`                                                     | `dot`                                                                                                                                                 |
| `node-count`           | Node list table, scroll wrapper, caption                             |                                                                |                                                                                                                                                       |
| `node-drawer-menu`     | ⋯ menu (Radix DropdownMenu; highlighted item has `data-highlighted`) |                                                                |                                                                                                                                                       |
| `node-favorite`        | Table cells                                                          |                                                                |                                                                                                                                                       |
| `node-id`              | Node table cell: id                                                  | `copied`, `idle`                                               |                                                                                                                                                       |
| `node-name`            | Name cell and names/ids in cards                                     |                                                                |                                                                                                                                                       |
| `node-row`             | One table row                                                        | `other`, `self`                                                | `offline`, `online`, `recent`, `stale`, … (from data)                                                                                                 |
| `node-self-badge`      | Name cell and names/ids in cards                                     |                                                                |                                                                                                                                                       |
| `node-short-name`      | Name cell and names/ids in cards                                     |                                                                |                                                                                                                                                       |
| `node-table`           | Node list table, scroll wrapper, caption                             |                                                                |                                                                                                                                                       |
| `node-table-wrap`      | Node list table, scroll wrapper, caption                             |                                                                |                                                                                                                                                       |
| `page-header`          | Page title block                                                     |                                                                |                                                                                                                                                       |
| `page-header-meta`     | Page title block                                                     |                                                                |                                                                                                                                                       |
| `page-heading`         | Page title block                                                     |                                                                |                                                                                                                                                       |
| `page-subtitle`        | Page title block                                                     |                                                                |                                                                                                                                                       |
| `page-title`           | Page heading                                                         |                                                                |                                                                                                                                                       |
| `panel`                | Dashboard grid and its panels                                        |                                                                | `attention`, `pinned`, `recent`, … (from data)                                                                                                        |
| `panel-actions`        | Dashboard grid and its panels                                        |                                                                |                                                                                                                                                       |
| `panel-body`           | Dashboard grid and its panels                                        |                                                                |                                                                                                                                                       |
| `panel-count`          | Dashboard grid and its panels                                        |                                                                |                                                                                                                                                       |
| `panel-header`         | Dashboard grid and its panels                                        |                                                                |                                                                                                                                                       |
| `panel-title`          | Dashboard grid and its panels                                        |                                                                |                                                                                                                                                       |
| `review-actions`       |                                                                      |                                                                |                                                                                                                                                       |
| `review-body`          |                                                                      |                                                                |                                                                                                                                                       |
| `review-dialog`        |                                                                      |                                                                | `duplicate-theme`, `maintenance`, `map-picker`, `request-telemetry`, `restore`, … (from data)                                                         |
| `review-header`        |                                                                      |                                                                |                                                                                                                                                       |
| `review-note`          |                                                                      |                                                                |                                                                                                                                                       |
| `review-title`         |                                                                      |                                                                |                                                                                                                                                       |
| `segment`              | One segment button                                                   | `active`, `inactive`                                           | `all`, `comfy`, `compact`, `custom`, `favorites`, `online`, `position`, … (from data)                                                                 |
| `send-button`          | Textarea and button                                                  |                                                                |                                                                                                                                                       |
| `settings-field`       | Settings                                                             |                                                                |                                                                                                                                                       |
| `skeleton`             | Empty and loading placeholders                                       |                                                                | `chart`, `drawer`, `feed`, `metric`, `panel`, … (from data)                                                                                           |
| `stale-note`           | Parts of a preview                                                   |                                                                |                                                                                                                                                       |
| `status-dot`           | Parts of the status pill                                             | `offline`, `online`, `recent`, `stale`, … (from data)          |                                                                                                                                                       |
| `toast`                | Toasts                                                               | `error`, `grouped`, `info`, `success`, … (from data)           | (from data)                                                                                                                                           |
| `visually-hidden`      | Screen-reader-only text                                              |                                                                |                                                                                                                                                       |

### Shell

| `data-mt`                | Element                                                          | `data-mt-state`                                                                                    | `data-mt-variant` |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `app-shell`              | Root grid                                                        | `auto`, `collapsed`, `expanded`, … (from data)                                                     |                   |
| `brand`                  | App name in the header                                           |                                                                                                    |                   |
| `brand-name`             | Parts of the brand                                               |                                                                                                    |                   |
| `connection-device`      | Header connection status (device and link hidden < 640 px)       |                                                                                                    |                   |
| `connection-device-name` | Header connection status (device and link hidden < 640 px)       |                                                                                                    |                   |
| `connection-indicator`   | Header connection status (device and link hidden < 640 px)       |                                                                                                    |                   |
| `connection-link`        | Header connection status (device and link hidden < 640 px)       |                                                                                                    |                   |
| `drawer-nav`             | Mobile navigation drawer (Radix Dialog) and its parts            |                                                                                                    |                   |
| `header`                 | Top bar                                                          |                                                                                                    |                   |
| `main`                   | Content area                                                     |                                                                                                    |                   |
| `menu-button`            | Mobile navigation drawer (Radix Dialog) and its parts            |                                                                                                    |                   |
| `nav-drawer`             | Mobile navigation drawer (Radix Dialog) and its parts            |                                                                                                    |                   |
| `nav-drawer-header`      | Mobile navigation drawer (Radix Dialog) and its parts            |                                                                                                    |                   |
| `nav-footer`             | Device name and link in the drawer                               |                                                                                                    |                   |
| `nav-footer-device`      | Device name and link in the drawer                               |                                                                                                    |                   |
| `nav-footer-link`        | Device name and link in the drawer                               |                                                                                                    |                   |
| `nav-item`               | Link in either navigation                                        | `active`, `inactive`                                                                               |                   |
| `nav-label`              | Text of a nav item                                               |                                                                                                    |                   |
| `sidebar`                | Sidebar (`aside`, ≥ 768 px), its nav, footer and collapse button |                                                                                                    |                   |
| `sidebar-footer`         | Sidebar (`aside`, ≥ 768 px), its nav, footer and collapse button |                                                                                                    |                   |
| `sidebar-nav`            | Sidebar (`aside`, ≥ 768 px), its nav, footer and collapse button |                                                                                                    |                   |
| `sidebar-toggle`         | Sidebar (`aside`, ≥ 768 px), its nav, footer and collapse button |                                                                                                    |                   |
| `socket-indicator`       | Shown while the browser's WS is down                             | `closed`, `connecting`, … (from data)                                                              |                   |
| `status-area`            | Wraps the pill and socket indicator                              |                                                                                                    |                   |
| `status-label`           | Parts of the status pill                                         |                                                                                                    |                   |
| `status-pill`            | Node connection status                                           | `configuring`, `connected`, `connecting`, `disconnected`, `reconnecting`, `unknown`, … (from data) |                   |
| `toast-text`             | Toasts                                                           |                                                                                                    |                   |
| `toaster`                | Toasts                                                           |                                                                                                    |                   |

### Sign-in and account

| `data-mt`        | Element                                                | `data-mt-state` | `data-mt-variant`                |
| ---------------- | ------------------------------------------------------ | --------------- | -------------------------------- |
| `auth-card`      | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `auth-field`     | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `auth-loading`   | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `auth-note`      | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `auth-screen`    | Sign-in / first-run setup / server-unreachable screens |                 | `error`, `login`, `setup`        |
| `auth-submit`    | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `auth-title`     | Sign-in / first-run setup / server-unreachable screens |                 |                                  |
| `user-menu`      | Header account menu                                    |                 | `admin`, `viewer`, … (from data) |
| `user-menu-name` | Header account menu                                    |                 |                                  |

### Theme

| `data-mt`         | Element                                                                                                                  | `data-mt-state` | `data-mt-variant` |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------- |
| `favicon`         | `<link rel="icon">` (badged with the unread count)                                                                       |                 |                   |
| `theme-link`      | `<link id="mt-theme">` to the active theme's CSS (`?v=<hash>`), and `#mt-theme-mode` for a theme's per-mode CSS (CR-004) |                 |                   |
| `theme-mode-link` | `<link>` to the active theme's per-mode CSS                                                                              |                 |                   |

<!-- hooks:end -->
