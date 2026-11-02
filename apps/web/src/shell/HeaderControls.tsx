import { Moon, Sun } from "lucide-react";
import { useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { openNodeDetails } from "../data/ui-store.js";
import { useThemeStore } from "../theme/store.js";
import { useActiveTheme, useMediaQuery } from "../theme/ThemeRuntime.js";
import { resolveMode } from "../theme/theme.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/**
 * Light / dark for themes that have both (CR-005 §6.1): flips what's showing now and
 * keeps it as the Mode setting. Settings → Appearance still offers System.
 */
export function ModeToggle() {
  const theme = useActiveTheme();
  const pref = useThemeStore((s) => s.modePref);
  const setModePref = useThemeStore((s) => s.setModePref);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const scheme = theme?.manifest?.colorScheme ?? "auto";
  if (scheme !== "auto") return null;
  const mode = resolveMode(scheme, pref, systemDark);
  const next = mode === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <button
      type="button"
      data-mt="mode-button"
      data-mt-state={mode}
      aria-label={label}
      title={label}
      onClick={() => {
        setModePref(next);
      }}
    >
      {mode === "dark" ? <Sun data-mt="icon" {...ICON} /> : <Moon data-mt="icon" {...ICON} />}
    </button>
  );
}

/**
 * My node in the header (CR-005 §6.1): its callsign, name and id; opens its details.
 * Nothing until the node has introduced itself.
 */
export function StationPill() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const { data: nodes } = useNodes(connectionId);
  const me = nodes?.find((n) => n.num === myNodeNum) ?? null;
  if (!me || myNodeNum === null) return null;
  const name = me.longName || me.shortName || me.id;
  return (
    <button
      type="button"
      data-mt="station-pill"
      aria-label={`My node: ${name}. Show details`}
      title={`${name} · ${me.id}`}
      onClick={() => {
        openNodeDetails(myNodeNum);
      }}
    >
      <span data-mt="station-pill-short">{me.shortName || "?"}</span>
      <span data-mt="station-pill-text">
        <span data-mt="station-pill-name">{name}</span>
        <span data-mt="station-pill-id">{me.id}</span>
      </span>
    </button>
  );
}
