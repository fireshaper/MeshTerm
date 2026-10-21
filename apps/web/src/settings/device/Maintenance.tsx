import type { MaintenanceAction } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../../data/api.js";
import { useUiStore } from "../../data/ui-store.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

interface ActionMeta {
  action: MaintenanceAction;
  title: string;
  description: string;
  warning?: string;
  /** Type the node's short name. */
  typed?: boolean;
  /** Seconds the confirm button waits (factory reset of the device). */
  countdown?: number;
  danger?: boolean;
}

/** CR-002 §5.8. Every action takes a config snapshot first (server side). */
export const ACTIONS: ActionMeta[] = [
  {
    action: "reboot",
    title: "Reboot",
    description: "Restart the node. MeshTerm reconnects on its own (usually 20–60 s).",
  },
  {
    action: "shutdown",
    title: "Shut down",
    description: "Turn the node off.",
    warning: "It won't come back until someone powers it on by hand.",
    danger: true,
  },
  {
    action: "nodedb_reset",
    title: "Reset node list",
    description:
      "Clear the node's list of other nodes. MeshTerm keeps its own history; the node relearns the mesh.",
  },
  {
    action: "factory_reset_config",
    title: "Factory reset (config)",
    description: "Put every setting back to the firmware defaults; keys and Bluetooth bonds stay.",
    warning:
      "Region, channels and network settings are reset too: the node may drop off the network.",
    typed: true,
    danger: true,
  },
  {
    action: "factory_reset_device",
    title: "Factory reset (device)",
    description: "Wipe everything: settings, keys, node list.",
    warning:
      "Network settings are almost certainly lost: MeshTerm will probably lose the connection for good.",
    typed: true,
    countdown: 5,
    danger: true,
  },
];

interface MaintenanceProps {
  connectionId: number | null;
  shortName: string;
  disabled: boolean;
}

export function Maintenance({ connectionId, shortName, disabled }: MaintenanceProps) {
  const [open, setOpen] = useState<ActionMeta | null>(null);
  return (
    <div data-mt="maintenance">
      {ACTIONS.map((a) => (
        <div
          key={a.action}
          data-mt="maintenance-action"
          data-mt-variant={a.danger ? "danger" : undefined}
        >
          <div>
            <h4 data-mt="maintenance-title">{a.title}</h4>
            <p data-mt="config-help">{a.description}</p>
          </div>
          <button
            type="button"
            data-mt="button"
            data-mt-variant={a.danger ? "danger" : undefined}
            disabled={disabled}
            onClick={() => {
              setOpen(a);
            }}
          >
            {a.title}…
          </button>
        </div>
      ))}
      <ConfirmDialog
        key={open?.action ?? "closed"}
        meta={open}
        connectionId={connectionId}
        shortName={shortName}
        onClose={() => {
          setOpen(null);
        }}
      />
    </div>
  );
}

function ConfirmDialog(props: {
  meta: ActionMeta | null;
  connectionId: number | null;
  shortName: string;
  onClose: () => void;
}) {
  const { meta } = props;
  const toast = useUiStore((s) => s.toast);
  const qc = useQueryClient();
  // Remounted per action (key), so the typed text and countdown start over.
  const [typed, setTyped] = useState("");
  const [left, setLeft] = useState(meta?.countdown ?? 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => {
      setLeft((n) => n - 1);
    }, 1000);
    return () => {
      clearTimeout(t);
    };
  }, [left]);

  const ready = meta !== null && (!meta.typed || typed.trim() === props.shortName) && left <= 0;

  async function run() {
    if (!meta || props.connectionId === null) return;
    setBusy(true);
    try {
      await api.maintenance(props.connectionId, meta.action, meta.typed ? typed.trim() : undefined);
      toast(`${meta.title}: sent to the node.`, "success");
      void qc.invalidateQueries({ queryKey: ["configSnapshots", props.connectionId] });
      props.onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={meta !== null}
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant="maintenance"
          aria-describedby="maintenance-note"
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">{meta?.title}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <div data-mt="review-body">
            <p data-mt="review-note" id="maintenance-note">
              {meta?.description} MeshTerm saves a snapshot of the config first.
            </p>
            {meta?.warning && (
              <p data-mt="config-warning">
                <TriangleAlert data-mt="icon" {...ICON} /> {meta.warning}
              </p>
            )}
            {meta?.typed && (
              <label data-mt="typed-confirm">
                <span>
                  Type the node&apos;s short name <strong>{props.shortName}</strong> to confirm.
                </span>
                <input
                  data-mt="typed-confirm-input"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                  }}
                />
              </label>
            )}
          </div>
          <footer data-mt="review-actions">
            <Dialog.Close asChild>
              <button type="button" data-mt="button">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              data-mt="button"
              data-mt-variant="danger-primary"
              disabled={!ready || busy}
              onClick={() => void run()}
            >
              {left > 0 ? `${meta?.title ?? ""} (${left})` : meta?.title}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
