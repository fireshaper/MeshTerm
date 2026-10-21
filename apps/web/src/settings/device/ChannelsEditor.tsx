import { ArrowDown, ArrowUp, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../data/api.js";
import { useUiStore } from "../../data/ui-store.js";
import { ChannelExportDialog, ChannelImportDialog } from "./ChannelLinkDialogs.js";
import { ConfigField } from "./ConfigField.js";
import { useEditsStore } from "./edits.js";
import { fieldProps, scalar, stage, type FieldContext } from "./field-props.js";
import { PskField } from "./PskField.js";
import { DEFAULT_PSK, precisionRadius } from "./registry.js";

const ICON = { "aria-hidden": true, focusable: false } as const;
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Every field of a channel the editor knows: what moves when channels are reordered. */
export const CHANNEL_LEAVES: Record<string, unknown> = {
  role: "DISABLED",
  "settings.name": "",
  "settings.psk": "",
  "settings.uplinkEnabled": false,
  "settings.downlinkEnabled": false,
  "settings.channelNum": 0,
  "settings.id": 0,
  "settings.moduleSettings.positionPrecision": 0,
  "settings.moduleSettings.isMuted": false,
};

const FORM: { leaf: string; kind: "string" | "bool" | "uint" }[] = [
  { leaf: "settings.name", kind: "string" },
  { leaf: "settings.psk", kind: "string" },
  { leaf: "settings.uplinkEnabled", kind: "bool" },
  { leaf: "settings.downlinkEnabled", kind: "bool" },
  { leaf: "settings.moduleSettings.positionPrecision", kind: "uint" },
  { leaf: "settings.moduleSettings.isMuted", kind: "bool" },
];

function encryption(psk: unknown): "none" | "default" | "private" {
  return psk === "" ? "none" : psk === DEFAULT_PSK ? "default" : "private";
}

const ENCRYPTION_LABEL = { none: "Unencrypted", default: "Default key", private: "Private key" };

/** Channels 0–7 (CR-002 §5.4): slots, the chosen channel's form, add/remove/reorder, links. */
export function ChannelsEditor({ ctx, admin }: { ctx: FieldContext; admin: boolean }) {
  const { get } = ctx;
  const toast = useUiStore((s) => s.toast);
  const [selected, setSelected] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const role = (i: number) => {
    const r = get(`channels.${i}.role`);
    return typeof r === "string" ? r : "DISABLED";
  };
  const free = SLOTS.find((i) => i > 0 && role(i) === "DISABLED");
  const editedIn = (i: number) =>
    Object.keys(ctx.edits).some((p) => p.startsWith(`channels.${i}.`));

  async function add() {
    if (free === undefined) return;
    try {
      const { psk } = await api.randomPsk(256);
      stage(ctx, `channels.${free}.role`, "SECONDARY");
      stage(ctx, `channels.${free}.settings.psk`, psk);
      setSelected(free);
    } catch {
      toast("Couldn't make a key for the new channel. Try again.", "error");
    }
  }

  function remove(i: number) {
    const { edits, reset } = useEditsStore.getState();
    if (ctx.cfg.channels.some((c) => (c.index ?? 0) === i && c.role !== "DISABLED")) {
      stage(ctx, `channels.${i}.role`, "DISABLED");
    } else {
      // Added in this session: just drop it.
      for (const p of Object.keys(edits)) if (p.startsWith(`channels.${i}.`)) reset(p);
    }
  }

  /** Swaps two slots' contents; the node re-indexes them on apply. */
  function swap(a: number, b: number) {
    // Fields a channel doesn't have yet take their protobuf defaults.
    const value = (i: number, leaf: string) => get(`channels.${i}.${leaf}`) ?? CHANNEL_LEAVES[leaf];
    for (const leaf of Object.keys(CHANNEL_LEAVES)) {
      const [va, vb] = [value(a, leaf), value(b, leaf)];
      const put = (i: number, v: unknown) => {
        // Unset and default are the same to the node: don't make an edit of it.
        const path = `channels.${i}.${leaf}`;
        if (get(path) === undefined && v === CHANNEL_LEAVES[leaf]) return;
        stage(ctx, path, v);
      };
      put(a, vb);
      put(b, va);
    }
    setSelected(b);
  }

  const current = role(selected) === "DISABLED" ? 0 : selected;
  const enabled = SLOTS.filter((i) => role(i) !== "DISABLED");

  return (
    <div data-mt="channels-editor">
      <ol data-mt="channel-list" aria-label="Channel slots">
        {SLOTS.map((i) => {
          const r = role(i);
          const name = get(`channels.${i}.settings.name`);
          const enc = encryption(get(`channels.${i}.settings.psk`));
          const precision = get(`channels.${i}.settings.moduleSettings.positionPrecision`);
          const up = get(`channels.${i}.settings.uplinkEnabled`) === true;
          const down = get(`channels.${i}.settings.downlinkEnabled`) === true;
          return (
            <li key={i}>
              <button
                type="button"
                data-mt="channel-slot"
                data-mt-variant={r.toLowerCase()}
                data-mt-state={
                  [i === current && r !== "DISABLED" && "active", editedIn(i) && "dirty"]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                aria-pressed={i === current && r !== "DISABLED"}
                disabled={r === "DISABLED"}
                onClick={() => {
                  setSelected(i);
                }}
              >
                <span data-mt="channel-slot-index">#{i}</span>
                <span data-mt="channel-slot-role">
                  {r === "PRIMARY" ? "Primary" : r === "SECONDARY" ? "Secondary" : "Disabled"}
                </span>
                {r !== "DISABLED" && (
                  <>
                    <span data-mt="channel-slot-name">
                      {typeof name === "string" && name !== ""
                        ? name
                        : i === 0
                          ? "(preset name)"
                          : "(no name)"}
                    </span>
                    <span data-mt="channel-slot-encryption" data-mt-state={enc}>
                      {enc === "private" ? (
                        <Lock data-mt="icon" {...ICON} />
                      ) : (
                        <LockOpen data-mt="icon" {...ICON} />
                      )}
                      {ENCRYPTION_LABEL[enc]}
                    </span>
                    <span data-mt="channel-slot-meta">
                      {[
                        up || down ? `MQTT ${up ? "↑" : ""}${down ? "↓" : ""}` : "",
                        typeof precision === "number" ? precisionRadius(precision) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {admin && (
        <div data-mt="channel-actions">
          <button
            type="button"
            data-mt="button"
            disabled={ctx.disabled || free === undefined}
            onClick={() => void add()}
          >
            <Plus data-mt="icon" {...ICON} /> Add channel
          </button>
          <button
            type="button"
            data-mt="button"
            onClick={() => {
              setExporting(true);
            }}
          >
            Share link / QR…
          </button>
          <button
            type="button"
            data-mt="button"
            disabled={ctx.disabled}
            onClick={() => {
              setImporting(true);
            }}
          >
            Import link…
          </button>
        </div>
      )}

      <fieldset data-mt="config-group" data-mt-variant="channel" aria-label={`Channel ${current}`}>
        <legend data-mt="config-group-title">
          Channel #{current} ({role(current) === "PRIMARY" ? "primary" : "secondary"})
        </legend>
        {FORM.map(({ leaf, kind }) => {
          const path = `channels.${current}.${leaf}`;
          const props = fieldProps(ctx, path, scalar(leaf.split(".").at(-1) ?? leaf, kind));
          return (
            <ConfigField
              key={path}
              {...props}
              {...(leaf === "settings.psk"
                ? {
                    renderInput: (common) => (
                      <PskField
                        common={common}
                        value={props.value}
                        onChange={(psk) => {
                          props.onChange(psk);
                        }}
                      />
                    ),
                  }
                : {})}
            />
          );
        })}
        {admin && role(current) === "SECONDARY" && (
          <div data-mt="channel-manage">
            <button
              type="button"
              data-mt="button"
              disabled={ctx.disabled || current <= 1}
              onClick={() => {
                swap(current, current - 1);
              }}
            >
              <ArrowUp data-mt="icon" {...ICON} /> Move up
            </button>
            <button
              type="button"
              data-mt="button"
              disabled={ctx.disabled || current >= 7 || role(current + 1) === "DISABLED"}
              onClick={() => {
                swap(current, current + 1);
              }}
            >
              <ArrowDown data-mt="icon" {...ICON} /> Move down
            </button>
            <button
              type="button"
              data-mt="button"
              data-mt-variant="danger"
              disabled={ctx.disabled}
              onClick={() => {
                remove(current);
                setSelected(0);
              }}
            >
              <Trash2 data-mt="icon" {...ICON} /> Remove channel
            </button>
            <small data-mt="config-help">
              Other nodes match channels by name and key, not by slot number.
            </small>
          </div>
        )}
      </fieldset>

      <ChannelExportDialog
        open={exporting}
        onOpenChange={setExporting}
        connectionId={ctx.connectionId}
        channels={enabled.map((i) => ({
          index: i,
          name: (() => {
            const name = get(`channels.${i}.settings.name`);
            return typeof name === "string" ? name : "";
          })(),
        }))}
        pending={Object.keys(ctx.edits).some(
          (p) => p.startsWith("channels.") || p.startsWith("config.lora."),
        )}
      />
      <ChannelImportDialog open={importing} onOpenChange={setImporting} ctx={ctx} roleOf={role} />
    </div>
  );
}
