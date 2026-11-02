import { formatAbsolute } from "../../dashboard/format.js";
import { hardwareLabel } from "../../dashboard/labels.js";
import type { ConfigView } from "./edits.js";
import { formatValue } from "./format.js";

/** My node at the top of the Device page (CR-005 §6.7): callsign, name, id, role and facts. */
export function DeviceHeader({ cfg, nodeState }: { cfg: ConfigView; nodeState: string | null }) {
  const owner = cfg.owner ?? {};
  const short = typeof owner.shortName === "string" ? owner.shortName : "";
  const long = typeof owner.longName === "string" ? owner.longName : "";
  const hw = typeof owner.hwModel === "string" ? hardwareLabel(owner.hwModel) : "—";
  const id = `!${cfg.myNodeNum.toString(16).padStart(8, "0")}`;
  const role = formatValue("config.device.role", cfg.config.device?.role ?? "CLIENT");
  const region = cfg.config.lora?.region;
  return (
    <header data-mt="device-header">
      <span data-mt="device-header-callsign">{short || "?"}</span>
      <div data-mt="device-header-names">
        <strong data-mt="device-header-name">{long || short || id}</strong>
        <span data-mt="device-header-id">
          {id} · {role}
        </span>
      </div>
      <dl data-mt="device-header-facts">
        <div>
          <dt>Hardware</dt>
          <dd>{hw}</dd>
        </div>
        <div>
          <dt>Firmware</dt>
          <dd>{cfg.firmware ?? "—"}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{typeof region === "string" && region !== "UNSET" ? region : "Not set"}</dd>
        </div>
        <div>
          <dt>Config read</dt>
          <dd data-mt="device-header-read">{formatAbsolute(cfg.receivedAt)}</dd>
        </div>
        <div>
          <dt>Link</dt>
          <dd data-mt="config-connection" data-mt-state={nodeState ?? "unknown"}>
            {nodeState ?? "…"}
          </dd>
        </div>
      </dl>
    </header>
  );
}
