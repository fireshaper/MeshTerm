import { ThemeId, type ThemeDTO } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState, type CSSProperties, type SyntheticEvent } from "react";
import { useIsAdmin } from "../auth/me.js";
import { ApiError, api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { useThemeStore } from "../theme/store.js";
import { useActiveTheme, useEffectMedia, useThemes } from "../theme/ThemeRuntime.js";
import type { ModePref } from "../theme/theme.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.";

const SOURCE_LABELS = {
  builtin: "Built-in",
  user: "User",
  override: "Overrides built-in",
} as const;

const MODES: { value: ModePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Previewing on hover restyles the whole page at once: not with reduced motion. */
const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `/settings/appearance` (CR-004 §4.7): the theme picker, mode, and admin defaults. */
export function AppearanceSettingsPage() {
  const admin = useIsAdmin();
  const { data } = useThemes();
  const active = useActiveTheme();
  const modePref = useThemeStore((s) => s.modePref);
  const setModePref = useThemeStore((s) => s.setModePref);
  const autoScheme = active?.manifest?.colorScheme === "auto";

  return (
    <section data-mt="settings-section" data-mt-variant="appearance">
      <h2 data-mt="settings-title">Appearance</h2>
      <div data-mt="appearance-settings">
        <fieldset data-mt="config-group" data-mt-variant="themes">
          <legend data-mt="config-group-title">Theme</legend>
          {!data ? (
            <p data-mt="skeleton">Loading themes…</p>
          ) : (
            <ThemeCards themes={data.themes} activeId={active?.id ?? null} admin={admin} />
          )}
        </fieldset>

        <fieldset data-mt="mode-toggle" disabled={!autoScheme}>
          <legend data-mt="config-group-title">Mode</legend>
          <div data-mt="mode-options" data-mt-variant="segmented">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                data-mt="segment"
                data-mt-variant={m.value}
                data-mt-state={modePref === m.value ? "active" : "inactive"}
                aria-pressed={modePref === m.value}
                onClick={() => {
                  setModePref(m.value);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p data-mt="config-help">
            {autoScheme
              ? "System follows your device's light or dark setting."
              : `${active?.manifest?.name ?? "This theme"} has a fixed ${active?.manifest?.colorScheme ?? "dark"} look.`}
          </p>
        </fieldset>

        <EffectsToggle theme={active} />

        {admin && data && (
          <AdminSection themes={data.themes} defaultId={data.defaultId} active={active} />
        )}

        <p data-mt="detail-note">
          Your choice is kept in this browser. To add a theme, put its folder in{" "}
          <code>/data/themes</code>: it shows up here within seconds, and edits apply while you
          watch.{" "}
          <a
            data-mt="theming-guide-link"
            href="https://github.com/fireshaper/MeshTerm/blob/main/THEMING.md"
            target="_blank"
            rel="noreferrer"
          >
            How to make a theme
          </a>
        </p>
      </div>
    </section>
  );
}

/** "Enable theme effects" (CR-004 §7), per browser. */
function EffectsToggle({ theme }: { theme: ThemeDTO | null }) {
  const enabled = useThemeStore((s) => s.effectsEnabled);
  const setEnabled = useThemeStore((s) => s.setEffectsEnabled);
  const media = useEffectMedia();
  const effects = theme?.manifest?.effects ?? [];
  const name = theme?.manifest?.name ?? "This theme";
  const help =
    effects.length === 0
      ? `${name} has no effects.`
      : media.moreContrast
        ? "Off while your device asks for more contrast."
        : media.reducedMotion
          ? "Effects that move stay off while your device asks for reduced motion."
          : `${name} draws ${effects.join(", ")} over the page. They never get in the way of clicks.`;
  return (
    <fieldset data-mt="effects-toggle" disabled={effects.length === 0}>
      <legend data-mt="config-group-title">Effects</legend>
      <label data-mt="check-row" data-mt-variant="setting">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        <span>Enable theme effects</span>
      </label>
      <p data-mt="config-help">{help}</p>
    </fieldset>
  );
}

function ThemeCards({
  themes,
  activeId,
  admin,
}: {
  themes: readonly ThemeDTO[];
  activeId: string | null;
  admin: boolean;
}) {
  const choose = useThemeStore((s) => s.choose);
  const preview = useThemeStore((s) => s.preview);
  const previewId = useThemeStore((s) => s.previewId);
  const start = (id: string) => {
    if (!reducedMotion()) preview(id);
  };
  const stop = () => {
    preview(null);
  };
  return (
    <div data-mt="theme-grid" role="radiogroup" aria-label="Theme" onPointerLeave={stop}>
      {themes.map((theme) => {
        const m = theme.manifest;
        const broken = !theme.valid || !m;
        const state = broken
          ? "broken"
          : theme.id === activeId
            ? "active"
            : theme.id === previewId
              ? "previewing"
              : "idle";
        const swatch = m
          ? ({
              "--mt-swatch-bg": m.preview.bg,
              "--mt-swatch-surface": m.preview.surface,
              "--mt-swatch-accent": m.preview.accent,
              "--mt-swatch-text": m.preview.text,
            } as CSSProperties)
          : undefined;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === activeId}
            disabled={broken}
            data-mt="theme-card"
            data-mt-state={state}
            data-mt-variant={theme.source}
            onPointerEnter={() => {
              if (!broken) start(theme.id);
            }}
            onFocus={() => {
              if (!broken) start(theme.id);
            }}
            onBlur={stop}
            onClick={() => {
              choose(theme.id);
            }}
          >
            <span data-mt="theme-swatch" style={swatch} aria-hidden="true">
              <span data-mt="theme-swatch-surface" />
              <span data-mt="theme-swatch-accent" />
              <span data-mt="theme-swatch-text">Aa</span>
            </span>
            <span data-mt="theme-card-name">{m?.name ?? theme.id}</span>
            <span data-mt="theme-card-meta">
              {[m?.author, m ? `v${m.version}` : null].filter(Boolean).join(" · ")}
            </span>
            <span data-mt="badge" data-mt-variant={theme.source}>
              {SOURCE_LABELS[theme.source]}
            </span>
            {m?.effects && m.effects.length > 0 && (
              <span data-mt="badge" data-mt-variant="effects">
                <Sparkles data-mt="icon" {...ICON} />
                Effects
              </span>
            )}
            {m?.description && <span data-mt="theme-card-description">{m.description}</span>}
            {admin && theme.error && (
              <span data-mt="config-warning" role="note">
                Broken: {theme.error}
              </span>
            )}
            {admin &&
              theme.warnings?.map((w) => (
                <span key={w} data-mt="config-help">
                  {w}
                </span>
              ))}
          </button>
        );
      })}
    </div>
  );
}

function AdminSection({
  themes,
  defaultId,
  active,
}: {
  themes: readonly ThemeDTO[];
  defaultId: string;
  active: ThemeDTO | null;
}) {
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const valid = themes.filter((t) => t.valid && t.manifest);

  async function setDefault(id: string) {
    setBusy(true);
    try {
      await api.setDefaultTheme(id);
      await qc.invalidateQueries({ queryKey: queryKeys.themes });
      toast("Server default theme saved. New browsers start with it.", "success");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset data-mt="config-group" data-mt-variant="theme-admin">
      <legend data-mt="config-group-title">For everyone (admins)</legend>
      <label data-mt="settings-field">
        <span>Server default theme</span>
        <select
          value={defaultId}
          disabled={busy}
          onChange={(e) => {
            void setDefault(e.target.value);
          }}
        >
          {valid.map((t) => (
            <option key={t.id} value={t.id}>
              {t.manifest?.name ?? t.id}
            </option>
          ))}
        </select>
      </label>
      <p data-mt="config-help">
        Browsers that haven&apos;t picked a theme use this one, including the sign-in page.
      </p>
      {active && <DuplicateTheme theme={active} existing={themes.map((t) => t.id)} />}
    </fieldset>
  );
}

/** Copies the selected theme into /data/themes as the start of a custom one (CR-004 §4.7). */
function DuplicateTheme({ theme, existing }: { theme: ThemeDTO; existing: readonly string[] }) {
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const choose = useThemeStore((s) => s.choose);
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idOk = ThemeId.safeParse(newId).success;
  const taken = existing.includes(newId);

  function reset() {
    let id = `${theme.id}-copy`.slice(0, 40);
    for (let n = 2; existing.includes(id); n++) id = `${theme.id}-copy-${n}`.slice(0, 40);
    setNewId(id);
    setName(`${theme.manifest?.name ?? theme.id} copy`.slice(0, 40));
    setError(null);
  }

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!idOk || taken || name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const copy = await api.duplicateTheme(theme.id, newId, name.trim());
      await qc.invalidateQueries({ queryKey: queryKeys.themes });
      choose(copy.id);
      setOpen(false);
      toast(`Copied to /data/themes/${copy.id}. Edit its theme.css to make it yours.`, "success");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" data-mt="button" data-mt-variant="duplicate-theme">
          Duplicate {theme.manifest?.name ?? theme.id} as a user theme
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant="duplicate-theme"
          aria-describedby="duplicate-theme-note"
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">
              Duplicate {theme.manifest?.name ?? theme.id}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <form data-mt="settings-form" onSubmit={(e) => void submit(e)}>
            <div data-mt="review-body">
              <p data-mt="review-note" id="duplicate-theme-note">
                The copy goes into <code>/data/themes</code>, where you can edit it. The original
                stays as it is.
              </p>
              <label data-mt="settings-field">
                <span>Folder and id</span>
                <input
                  value={newId}
                  maxLength={40}
                  aria-invalid={!idOk || taken}
                  onChange={(e) => {
                    setNewId(e.target.value);
                  }}
                />
              </label>
              {!idOk && (
                <p data-mt="config-help">Lowercase letters, digits and dashes (at most 40).</p>
              )}
              {taken && <p data-mt="config-help">A theme with this id already exists.</p>}
              <label data-mt="settings-field">
                <span>Name</span>
                <input
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </label>
              {error && (
                <p data-mt="config-warning" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer data-mt="review-actions">
              <Dialog.Close asChild>
                <button type="button" data-mt="button">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                data-mt="button"
                data-mt-variant="primary"
                disabled={busy || !idOk || taken || name.trim() === ""}
              >
                Duplicate
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
