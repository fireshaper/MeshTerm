import { TELEMETRY_KINDS, type ServerMessageOf, type TelemetryKind } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, X } from "lucide-react";
import { useState } from "react";
import { useIsAdmin } from "../auth/me.js";
import { ApiError, api } from "../data/api.js";
import { useLiveStore } from "../data/store.js";
import { useUiStore } from "../data/ui-store.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** Nodes further away aren't offered the button (CR-001 §7.5). */
export const MAX_HOPS = 3;

export const KIND_LABELS: Record<TelemetryKind, string> = {
  device: "Device (battery, channel use)",
  environment: "Environment (temperature, humidity…)",
  power: "Power (voltages, currents)",
  air_quality: "Air quality",
};

/** Requests this browser made and is waiting on: `connectionId:num:kind` → short name. */
const waiting = new Map<string, string>();

/** `telemetry.request` from the server: tell the user who asked how it went. */
export function handleTelemetryRequest(
  m: Omit<ServerMessageOf<"telemetry.request">, "type">,
): void {
  const key = `${m.connectionId}:${m.nodeNum}:${m.kind}`;
  const name = waiting.get(key);
  if (name === undefined || m.state === "sent") return;
  waiting.delete(key);
  const toast = useUiStore.getState().toast;
  if (m.state === "received")
    toast(`${name} sent its ${m.kind.replace("_", " ")} telemetry.`, "success");
  else toast(`No ${m.kind.replace("_", " ")} telemetry from ${name} after 60 s.`, "error");
}

export function canRequestTelemetry(node: { isSelf: boolean; hopsAway: number | null }): boolean {
  return !node.isSelf && (node.hopsAway === null || node.hopsAway <= MAX_HOPS);
}

/** "Request telemetry": asks the node for a report, after a confirmation (it transmits). */
export function RequestTelemetry({
  num,
  shortName,
  kinds,
}: {
  num: number;
  shortName: string;
  /** What the node has reported before; the first is preselected. */
  kinds: readonly TelemetryKind[];
}) {
  const admin = useIsAdmin();
  const connectionId = useLiveStore((s) => s.connectionId);
  const toast = useUiStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TelemetryKind>(kinds[0] ?? "device");
  const [busy, setBusy] = useState(false);
  if (!admin || connectionId === null) return null;

  async function send() {
    if (connectionId === null) return;
    setBusy(true);
    try {
      await api.requestTelemetry(connectionId, num, kind);
      waiting.set(`${connectionId}:${num}:${kind}`, shortName);
      toast(`Asked ${shortName} for its ${kind.replace("_", " ")} telemetry.`, "success");
      setOpen(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" data-mt="button" data-mt-variant="request-telemetry">
          <Activity data-mt="icon" {...ICON} />
          Request telemetry
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content
          data-mt="review-dialog"
          data-mt-variant="request-telemetry"
          aria-describedby="request-telemetry-note"
        >
          <header data-mt="review-header">
            <Dialog.Title data-mt="review-title">Request telemetry from {shortName}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <div data-mt="review-body">
            <p data-mt="review-note" id="request-telemetry-note">
              This sends a request over the mesh, and the node&apos;s answer comes back the same
              way: both use airtime that other nodes share. You can ask a node once every 5 minutes.
            </p>
            <label data-mt="settings-field">
              <span>What to ask for</span>
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as TelemetryKind);
                }}
              >
                {TELEMETRY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
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
              data-mt-variant="primary"
              disabled={busy}
              onClick={() => void send()}
            >
              Send request
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
