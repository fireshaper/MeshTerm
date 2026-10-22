import {
  DND_FOREVER,
  type NotificationPrefsDTO,
  type NotificationPrefsPatch,
  type ReactionsMode,
} from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useNow } from "../components/useNow.js";
import { ApiError, api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { dndActive, tomorrowMorning } from "../notifications/NotificationBell.js";
import { desktopSupport, requestDesktopPermission } from "../notifications/desktop.js";
import { useNotificationPrefs } from "../notifications/runtime.js";
import { useBrowserNotifySettings, type BrowserNotifySettings } from "../notifications/settings.js";
import { SoundPlayer } from "../notifications/sounds.js";

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.";

/** "+02:00" for an offset in minutes. */
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const m = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `/settings/notifications` (CR-003 §10): this browser's settings and the user's. */
export function NotificationSettingsPage() {
  return (
    <section data-mt="settings-section" data-mt-variant="notifications">
      <h2 data-mt="settings-title">Notifications</h2>
      <BrowserSection />
      <AccountSection />
      <p data-mt="detail-note">
        Each conversation can notify for all messages, mentions only, or nothing: use the bell in
        the conversation&apos;s header or its ⋯ menu. DMs notify by default; channels only when they
        mention you.
      </p>
    </section>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
  help,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
}) {
  return (
    <label data-mt="check-row" data-mt-variant="setting">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span>
        {label}
        {help && <small data-mt="config-help"> {help}</small>}
      </span>
    </label>
  );
}

let previewPlayer: SoundPlayer | null = null;

function BrowserSection() {
  const settings = useBrowserNotifySettings((s) => s.settings);
  const update = useBrowserNotifySettings((s) => s.update);
  const [support, setSupport] = useState(desktopSupport);
  const set = (patch: Partial<BrowserNotifySettings>) => {
    update(patch);
  };
  const types = (patch: Partial<BrowserNotifySettings["soundTypes"]>) => {
    update({ soundTypes: { ...settings.soundTypes, ...patch } });
  };

  async function toggleDesktop(on: boolean) {
    if (!on) {
      set({ desktop: false });
      return;
    }
    const granted = await requestDesktopPermission();
    setSupport(desktopSupport());
    set({ desktop: granted });
  }

  const desktopNote =
    support.state === "unsupported"
      ? "This browser can't show desktop notifications."
      : support.state === "insecure"
        ? "Browsers only allow desktop notifications on HTTPS (or localhost). Put MeshTerm behind HTTPS, e.g. a reverse proxy with a certificate (Caddy, Traefik, Nginx Proxy Manager) or Tailscale HTTPS; see the README. Everything else on this page works without it."
        : support.permission === "denied"
          ? "Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address), then turn this on."
          : null;

  return (
    <form
      data-mt="settings-form"
      data-mt-variant="wide"
      aria-labelledby="notify-browser-title"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <h3 data-mt="settings-subtitle" id="notify-browser-title">
        This browser
      </h3>
      <p data-mt="detail-note">
        Saved in this browser only, so a wall display and a laptop can differ.
      </p>

      <Check
        label="Pop-up notifications"
        checked={settings.toasts}
        onChange={(toasts) => {
          set({ toasts });
        }}
      />
      <label data-mt="settings-field">
        <span>Where they appear (desktop)</span>
        <select
          value={settings.toastPosition}
          disabled={!settings.toasts}
          onChange={(e) => {
            set({ toastPosition: e.target.value as BrowserNotifySettings["toastPosition"] });
          }}
        >
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
        </select>
      </label>

      <Check
        label="Flash the tab title while it's in the background"
        checked={settings.titleFlash}
        onChange={(titleFlash) => {
          set({ titleFlash });
        }}
      />

      <Check
        label="Sounds"
        checked={settings.sounds}
        onChange={(sounds) => {
          set({ sounds });
        }}
      />
      <label data-mt="settings-field">
        <span>Volume ({Math.round(settings.volume * 100)} %)</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(settings.volume * 100)}
          disabled={!settings.sounds}
          onChange={(e) => {
            set({ volume: Number(e.target.value) / 100 });
          }}
        />
      </label>
      <fieldset data-mt="config-group" disabled={!settings.sounds}>
        <legend data-mt="config-group-title">Play a sound for</legend>
        <Check
          label="Direct messages"
          checked={settings.soundTypes.message}
          onChange={(message) => {
            types({ message });
          }}
        />
        <Check
          label="Mentions and replies"
          checked={settings.soundTypes.mention}
          onChange={(mention) => {
            types({ mention });
          }}
        />
        <Check
          label="Channels set to all messages"
          checked={settings.soundTypes.channel}
          onChange={(channel) => {
            types({ channel });
          }}
        />
        <button
          type="button"
          data-mt="button"
          onClick={() => {
            previewPlayer ??= new SoundPlayer();
            void previewPlayer.load().then(() => {
              previewPlayer?.play("message", settings.volume);
            });
          }}
        >
          Play a test sound
        </button>
      </fieldset>

      <Check
        label="Desktop notifications"
        help="When MeshTerm isn't the focused window."
        checked={settings.desktop && support.state === "ready" && support.permission === "granted"}
        disabled={support.state !== "ready" || support.permission === "denied"}
        onChange={(on) => void toggleDesktop(on)}
      />
      {desktopNote && (
        <p data-mt="config-warning" data-mt-variant="desktop">
          {desktopNote}
        </p>
      )}
      <Check
        label="Hide message text in desktop notifications"
        help="Shows only “New direct message”, for shared screens."
        checked={settings.hideText}
        disabled={!settings.desktop}
        onChange={(hideText) => {
          set({ hideText });
        }}
      />
    </form>
  );
}

function AccountSection() {
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const { data: prefs, isPending, isError } = useNotificationPrefs();
  const [keywords, setKeywords] = useState<string | null>(null);

  const save = (patch: NotificationPrefsPatch, done?: string) => {
    api.updateNotificationPrefs(patch).then(
      (next) => {
        qc.setQueryData(queryKeys.notificationPrefs, next);
        if (done) toast(done, "success");
      },
      (err: unknown) => {
        toast(errorText(err), "error");
      },
    );
  };

  if (isPending) return <div data-mt="skeleton" aria-hidden />;
  if (isError) return <p role="alert">Your notification settings couldn&apos;t be loaded.</p>;

  return (
    <div
      data-mt="settings-form"
      data-mt-variant="wide"
      role="group"
      aria-labelledby="notify-account-title"
    >
      <h3 data-mt="settings-subtitle" id="notify-account-title">
        Your account
      </h3>
      <p data-mt="detail-note">The same in every browser you sign in to.</p>
      <DndControls prefs={prefs} save={save} />
      <QuietHours prefs={prefs} save={save} />

      <form
        data-mt="settings-field"
        onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
          e.preventDefault();
          if (keywords === null) return;
          save(
            {
              mentionKeywords: keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
            },
            "Mention keywords saved.",
          );
          setKeywords(null);
        }}
      >
        <label data-mt="settings-field" htmlFor="mention-keywords">
          <span>Mention keywords</span>
        </label>
        <small data-mt="config-help" id="mention-keywords-help">
          Comma-separated words that count as mentioning you (a callsign, &quot;base&quot;…). Your
          node&apos;s long and short names always count.
        </small>
        <div data-mt="inline-form">
          <input
            id="mention-keywords"
            aria-describedby="mention-keywords-help"
            value={keywords ?? prefs.mentionKeywords.join(", ")}
            onChange={(e) => {
              setKeywords(e.target.value);
            }}
          />
          <button type="submit" data-mt="button" disabled={keywords === null}>
            Save
          </button>
        </div>
      </form>

      <Check
        label="My short name on its own counts as a mention"
        help="Off: only @shortname does (fewer false alarms for names like BASE)."
        checked={prefs.matchShortName}
        onChange={(matchShortName) => {
          save({ matchShortName });
        }}
      />
      <label data-mt="settings-field">
        <span>Reactions to my messages</span>
        <select
          value={prefs.reactionsMode}
          onChange={(e) => {
            save({ reactionsMode: e.target.value as ReactionsMode });
          }}
        >
          <option value="in-app">Show in MeshTerm only</option>
          <option value="notify">Notify (sound and desktop too)</option>
          <option value="off">Don&apos;t notify</option>
        </select>
      </label>
    </div>
  );
}

type Save = (patch: NotificationPrefsPatch, done?: string) => void;

function DndControls({ prefs, save }: { prefs: NotificationPrefsDTO; save: Save }) {
  const now = useNow();
  const on = dndActive(prefs, now);
  return (
    <fieldset data-mt="config-group" data-mt-variant="dnd">
      <legend data-mt="config-group-title">Do Not Disturb</legend>
      <p data-mt="dnd-status" role="status">
        {!on
          ? "Off. Badges and the bell still count while it's on; nothing pops up or plays."
          : prefs.dndUntil !== null && prefs.dndUntil >= DND_FOREVER
            ? "On until you turn it off."
            : `On until ${new Date(prefs.dndUntil ?? 0).toLocaleString()}.`}
      </p>
      <div data-mt="inline-form">
        <button
          type="button"
          data-mt="button"
          onClick={() => {
            save({ dndUntil: Date.now() + 3600_000 });
          }}
        >
          1 hour
        </button>
        <button
          type="button"
          data-mt="button"
          onClick={() => {
            save({ dndUntil: tomorrowMorning(Date.now()) });
          }}
        >
          Until tomorrow
        </button>
        <button
          type="button"
          data-mt="button"
          onClick={() => {
            save({ dndUntil: DND_FOREVER });
          }}
        >
          Until I turn it off
        </button>
        {on && (
          <button
            type="button"
            data-mt="button"
            onClick={() => {
              save({ dndUntil: null });
            }}
          >
            Turn off
          </button>
        )}
      </div>
    </fieldset>
  );
}

function QuietHours({ prefs, save }: { prefs: NotificationPrefsDTO; save: Save }) {
  const [start, setStart] = useState(prefs.quietHours?.start ?? "22:00");
  const [end, setEnd] = useState(prefs.quietHours?.end ?? "07:00");
  const enabled = prefs.quietHours !== null;
  return (
    <fieldset data-mt="config-group" data-mt-variant="quiet-hours">
      <legend data-mt="config-group-title">Quiet hours</legend>
      <Check
        label="Quiet hours every day"
        help={`Like Do Not Disturb, in the server's time zone (${offsetText(prefs.serverUtcOffsetMinutes)}).`}
        checked={enabled}
        onChange={(on) => {
          save({ quietHours: on ? { start, end } : null });
        }}
      />
      <div data-mt="inline-form">
        <label data-mt="settings-field">
          <span>From</span>
          <input
            type="time"
            value={start}
            disabled={!enabled}
            onChange={(e) => {
              setStart(e.target.value);
            }}
            onBlur={() => {
              if (enabled && start !== prefs.quietHours?.start)
                save({ quietHours: { start, end } });
            }}
          />
        </label>
        <label data-mt="settings-field">
          <span>To</span>
          <input
            type="time"
            value={end}
            disabled={!enabled}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
            onBlur={() => {
              if (enabled && end !== prefs.quietHours?.end) save({ quietHours: { start, end } });
            }}
          />
        </label>
      </div>
      <Check
        label="Let direct messages through during quiet hours"
        checked={prefs.quietAllowDms}
        disabled={!enabled}
        onChange={(quietAllowDms) => {
          save({ quietAllowDms });
        }}
      />
    </fieldset>
  );
}
