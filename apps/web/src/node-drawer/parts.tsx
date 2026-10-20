import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { formatAbsolute, formatAgo } from "../dashboard/format.js";
import { ageLabel } from "../dashboard/insights.js";
import { useUiStore } from "../data/ui-store.js";

export const NA = "Not available";
export const ICON = { "aria-hidden": true, focusable: false } as const;

export function Field({
  name,
  label,
  children,
}: {
  name: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-mt="detail-field" data-mt-variant={name}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Section({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-mt="detail-section" data-mt-variant={name}>
      <h3 data-mt="detail-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** "reported 3 min ago", or the stale age label when old. */
export function Reported({ time, now, stale }: { time: number; now: number; stale: boolean }) {
  return (
    <span data-mt={stale ? "stale-note" : "detail-age"} title={formatAbsolute(time)}>
      {stale ? `reported ${ageLabel(time, now)}` : `reported ${formatAgo(time, now)}`}
    </span>
  );
}

/** Copies `value` and says so in a toast. Clipboard is missing over plain HTTP. */
export function useCopy() {
  const toast = useUiStore((s) => s.toast);
  return (value: string, what = value) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing over plain HTTP
    if (!navigator.clipboard) {
      toast("Copying needs HTTPS or localhost.", "error");
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => {
        toast(`Copied ${what}`, "success");
      },
      () => {
        toast("Couldn't copy.", "error");
      },
    );
  };
}

export function CopyButton({
  value,
  label,
  what,
  children,
}: {
  value: string;
  /** Accessible name, e.g. "Copy node ID". */
  label: string;
  what?: string;
  children?: ReactNode;
}) {
  const copy = useCopy();
  return (
    <button
      type="button"
      data-mt="copy-id"
      aria-label={children ? undefined : label}
      title={label}
      onClick={() => {
        copy(value, what);
      }}
    >
      {children}
      <Copy data-mt="icon" {...ICON} />
    </button>
  );
}
