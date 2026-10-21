import type { ChannelUrlDTO, ParsedChannelUrlDTO, ProtoJson } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApiError, api } from "../../data/api.js";
import { useUiStore } from "../../data/ui-store.js";
import { stage, type FieldContext } from "./field-props.js";
import { formatChange, labelFor } from "./format.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

function Shell(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  variant: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant={props.variant}
          aria-describedby={undefined}
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">{props.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <div data-mt="review-body">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.";

interface ExportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: number | null;
  channels: { index: number; name: string }[];
  /** Channel or LoRa edits are staged: the link shows the node's current settings. */
  pending: boolean;
}

/** The Meshtastic channel link and QR code for chosen channels (CR-002 §5.4). */
export function ChannelExportDialog(props: ExportProps) {
  const toast = useUiStore((s) => s.toast);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [lora, setLora] = useState(true);
  const [link, setLink] = useState<ChannelUrlDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = chosen ?? new Set(props.channels.map((c) => c.index));

  async function create() {
    if (props.connectionId === null) return;
    setError(null);
    try {
      setLink(await api.channelUrl(props.connectionId, [...picked].sort(), lora));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Shell
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setLink(null);
          setChosen(null);
        }
        props.onOpenChange(open);
      }}
      title="Share channels"
      variant="channel-export"
    >
      <fieldset data-mt="config-group">
        <legend data-mt="config-group-title">Channels in the link</legend>
        {props.channels.map((c) => (
          <label key={c.index} data-mt="check-row">
            <input
              type="checkbox"
              checked={picked.has(c.index)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(c.index);
                else next.delete(c.index);
                setChosen(next);
                setLink(null);
              }}
            />
            #{c.index} {c.name || (c.index === 0 ? "Primary" : "(no name)")}
          </label>
        ))}
        <label data-mt="check-row">
          <input
            type="checkbox"
            checked={lora}
            onChange={(e) => {
              setLora(e.target.checked);
              setLink(null);
            }}
          />
          Include the LoRa settings (region, preset…)
        </label>
      </fieldset>
      <p data-mt="config-warning">
        <TriangleAlert data-mt="icon" {...ICON} /> The link contains the channel keys: anyone who
        has it can read and send on these channels.
      </p>
      {props.pending && (
        <p data-mt="review-note">
          Staged edits aren&apos;t in the link: it has the node&apos;s current settings.
        </p>
      )}
      {error && (
        <p data-mt="auth-error" role="alert">
          {error}
        </p>
      )}
      {link ? (
        <div data-mt="channel-link">
          <svg
            data-mt="qr-code"
            viewBox={`0 0 ${link.qr.size} ${link.qr.size}`}
            role="img"
            aria-label="QR code of the channel link"
            shapeRendering="crispEdges"
          >
            <path d={link.qr.path} fill="currentColor" />
          </svg>
          <label data-mt="settings-field">
            <span>Channel link</span>
            <textarea
              readOnly
              rows={3}
              value={link.url}
              onFocus={(e) => {
                e.target.select();
              }}
            />
          </label>
          <button
            type="button"
            data-mt="button"
            onClick={() => {
              void navigator.clipboard.writeText(link.url).then(
                () => {
                  toast("Link copied.", "success");
                },
                () => {
                  toast("Couldn't copy the link.", "error");
                },
              );
            }}
          >
            <Copy data-mt="icon" {...ICON} /> Copy link
          </button>
        </div>
      ) : (
        <footer data-mt="review-actions">
          <button
            type="button"
            data-mt="button"
            data-mt-variant="primary"
            disabled={picked.size === 0}
            onClick={() => void create()}
          >
            Create link
          </button>
        </footer>
      )}
    </Shell>
  );
}

/** The leaves of a link's channel that are staged into a slot. */
const LEAVES = [
  "name",
  "psk",
  "uplinkEnabled",
  "downlinkEnabled",
  "channelNum",
  "id",
  "moduleSettings.positionPrecision",
  "moduleSettings.isMuted",
];

const leaf = (obj: ProtoJson, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (cur, k) => (typeof cur === "object" && cur !== null ? (cur as ProtoJson)[k] : undefined),
      obj,
    );

export type ImportMode = "add" | "replace";

/**
 * The edits a link makes (CR-002 §5.4): **add** puts its channels into free slots (skipping
 * ones already there by name and key); **replace** makes them channels 0… and disables the
 * rest. Optionally the link's LoRa settings too. Throws when there aren't enough free slots.
 */
export function importEdits(
  parsed: ParsedChannelUrlDTO,
  mode: ImportMode,
  withLora: boolean,
  get: (path: string) => unknown,
): [string, unknown][] {
  const out: [string, unknown][] = [];
  const role = (i: number) => get(`channels.${i}.role`) ?? "DISABLED";
  const put = (slot: number, settings: ProtoJson, r: string) => {
    out.push([`channels.${slot}.role`, r]);
    for (const l of LEAVES) {
      const v = leaf(settings, l);
      if (v !== undefined) out.push([`channels.${slot}.settings.${l}`, v]);
    }
  };
  if (mode === "replace") {
    for (let i = 0; i < 8; i++) {
      const settings = parsed.settings[i];
      if (settings) put(i, settings, i === 0 ? "PRIMARY" : "SECONDARY");
      else if (role(i) !== "DISABLED") out.push([`channels.${i}.role`, "DISABLED"]);
    }
  } else {
    const have = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7]
        .filter((i) => role(i) !== "DISABLED")
        .map(
          (i) =>
            `${String(get(`channels.${i}.settings.name`))}|${String(get(`channels.${i}.settings.psk`))}`,
        ),
    );
    const free = [1, 2, 3, 4, 5, 6, 7].filter((i) => role(i) === "DISABLED");
    const adding = parsed.settings.filter((s) => !have.has(`${str(s.name)}|${str(s.psk)}`));
    if (adding.length > free.length) {
      throw new Error(
        `The link has ${adding.length} new channels but only ${free.length} slots are free. Use Replace, or remove channels first.`,
      );
    }
    adding.forEach((s, k) => {
      put(free[k] ?? 0, s, "SECONDARY");
    });
  }
  if (withLora && parsed.lora) {
    for (const [k, v] of Object.entries(parsed.lora)) {
      const path = `config.lora.${k}`;
      if (get(path) !== undefined && JSON.stringify(get(path)) !== JSON.stringify(v))
        out.push([path, v]);
    }
  }
  // Only what actually changes.
  return out.filter(([path, v]) => JSON.stringify(get(path)) !== JSON.stringify(v));
}

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: FieldContext;
  roleOf: (index: number) => string;
}

/** Paste a channel link, see what it changes, and stage it for the normal review (CR-002 §5.4). */
export function ChannelImportDialog({ open, onOpenChange, ctx }: ImportProps) {
  const toast = useUiStore((s) => s.toast);
  const [url, setUrl] = useState("");
  const [parsed, setParsed] = useState<ParsedChannelUrlDTO | null>(null);
  const [mode, setMode] = useState<ImportMode>("add");
  const [withLora, setWithLora] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let planned: [string, unknown][] = [];
  let planError: string | null = null;
  if (parsed) {
    try {
      planned = importEdits(parsed, mode, withLora, ctx.get);
    } catch (err) {
      planError = err instanceof Error ? err.message : String(err);
    }
  }

  async function read() {
    if (ctx.connectionId === null) return;
    setError(null);
    try {
      const p = await api.parseChannelUrl(ctx.connectionId, url);
      setParsed(p);
      setMode(p.add ? "add" : "replace");
      setWithLora(!p.add && p.lora !== null);
    } catch (err) {
      setParsed(null);
      setError(errorText(err));
    }
  }

  function close(next: boolean) {
    if (!next) {
      setUrl("");
      setParsed(null);
      setError(null);
    }
    onOpenChange(next);
  }

  return (
    <Shell open={open} onOpenChange={close} title="Import a channel link" variant="channel-import">
      <label data-mt="settings-field">
        <span>Channel link</span>
        <textarea
          rows={3}
          placeholder="https://meshtastic.org/e/#…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setParsed(null);
          }}
        />
      </label>
      {!parsed && (
        <footer data-mt="review-actions">
          <button
            type="button"
            data-mt="button"
            data-mt-variant="primary"
            disabled={url.trim() === ""}
            onClick={() => void read()}
          >
            Read link
          </button>
        </footer>
      )}
      {error && (
        <p data-mt="auth-error" role="alert">
          {error}
        </p>
      )}
      {parsed && (
        <>
          <p data-mt="review-note">
            The link has {parsed.settings.length}{" "}
            {parsed.settings.length === 1 ? "channel" : "channels"}:{" "}
            {parsed.settings
              .map((s, i) => str(s.name) || (i === 0 ? "(preset name)" : "(no name)"))
              .join(", ")}
            {parsed.lora ? ", and LoRa settings" : ""}.
          </p>
          <fieldset data-mt="config-group" aria-label="How to import">
            <label data-mt="check-row">
              <input
                type="radio"
                name="import-mode"
                checked={mode === "add"}
                onChange={() => {
                  setMode("add");
                }}
              />
              Add: put them in free slots, keep my channels
            </label>
            <label data-mt="check-row">
              <input
                type="radio"
                name="import-mode"
                checked={mode === "replace"}
                onChange={() => {
                  setMode("replace");
                }}
              />
              Replace: these become all my channels
            </label>
            {parsed.lora && (
              <label data-mt="check-row">
                <input
                  type="checkbox"
                  checked={withLora}
                  onChange={(e) => {
                    setWithLora(e.target.checked);
                  }}
                />
                Also use the link&apos;s LoRa settings
              </label>
            )}
          </fieldset>
          {planError ? (
            <p data-mt="review-blocked" role="alert">
              {planError}
            </p>
          ) : planned.length === 0 ? (
            <p data-mt="review-note">Nothing to change: the node already has these settings.</p>
          ) : (
            <table data-mt="review-table" aria-label="Changes from the link">
              <tbody>
                {planned.map(([path, value]) => {
                  const [from, to] = formatChange(path, ctx.get(path), value);
                  return (
                    <tr key={path} data-mt="diff-row" data-path={path}>
                      <th scope="row">{labelFor(path, ctx.get)}</th>
                      <td data-mt="diff-from">{from}</td>
                      <td data-mt="diff-arrow" aria-label="to">
                        →
                      </td>
                      <td data-mt="diff-to">{to}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <footer data-mt="review-actions">
            <button
              type="button"
              data-mt="button"
              data-mt-variant="primary"
              disabled={planError !== null || planned.length === 0}
              onClick={() => {
                for (const [path, value] of planned) stage(ctx, path, value);
                toast(`${planned.length} changes staged: review and apply them.`, "success");
                close(false);
              }}
            >
              Stage {planned.length} {planned.length === 1 ? "change" : "changes"}
            </button>
          </footer>
        </>
      )}
    </Shell>
  );
}
