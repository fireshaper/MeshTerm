/** Short display formats for dashboard values. */

/** "45s", "5m", "2h 14m", "3d 4h": the two largest units, without zeros after the first. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}

/** "just now", "4 s ago", "3 min ago", "2 h ago", "3 d ago". Future times count as now. */
export function formatAgo(time: number, now: number): string {
  const s = Math.floor(Math.max(0, now - time) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** Absolute local date and time, for `title` tooltips. */
export function formatAbsolute(time: number): string {
  return new Date(time).toLocaleString();
}

/** "12.3%"; one decimal at most. */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

/** "22.4 °C · 61% · 1013 hPa", skipping missing readings; null when none. */
export function formatEnvironment(env: {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
}): string | null {
  const parts = [
    env.temperature === null ? null : `${Number(env.temperature.toFixed(1))} °C`,
    env.humidity === null ? null : `${Math.round(env.humidity)}%`,
    env.pressure === null ? null : `${Math.round(env.pressure)} hPa`,
  ].filter((p) => p !== null);
  return parts.length ? parts.join(" · ") : null;
}
