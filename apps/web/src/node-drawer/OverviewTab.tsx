import { nodeIdFromNum, type LatestTelemetry, type NodeDetailDTO } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { InfoTip } from "../components/InfoTip.js";
import { useNow } from "../components/useNow.js";
import { BatteryMeter } from "../dashboard/BatteryMeter.js";
import { formatAbsolute, formatAgo, formatDuration, formatPercent } from "../dashboard/format.js";
import {
  bearingDegrees,
  cardinal,
  formatDistance,
  haversineMeters,
  precisionRadiusMeters,
} from "../dashboard/geo.js";
import { isStale } from "../dashboard/insights.js";
import { hardwareLabel, roleLabel } from "../dashboard/labels.js";
import { MiniMap } from "../dashboard/MiniMap.js";
import { SignalBars } from "../dashboard/SignalBars.js";
import { useConversation } from "../data/queries.js";
import { useThresholds } from "../messages/useNodeMap.js";
import { formatMetric, metricInfo, orderedMetrics } from "./metrics.js";
import { CopyButton, Field, ICON, NA, Reported, Section } from "./parts.js";

function hopsText(hops: number | null): string {
  if (hops === null) return NA;
  if (hops === 0) return "Heard directly";
  return `${hops} ${hops === 1 ? "hop" : "hops"} (route not known)`;
}

/** Every metric of a report, under its own label (environment, power monitor, air quality). */
function MetricFields({ report }: { report: LatestTelemetry }) {
  return (
    <dl data-mt="detail-fields">
      {orderedMetrics(report.metrics).map(([name, value]) => (
        <Field key={name} name={name} label={metricInfo(name).label}>
          {formatMetric(name, value)}
        </Field>
      ))}
    </dl>
  );
}

function RecentMessages({ connectionId, num }: { connectionId: number; num: number }) {
  const now = useNow();
  const { data, isPending } = useConversation(connectionId, { peer: num });
  const recent = (data?.messages ?? []).slice(-5).reverse();
  return (
    <Section name="messages" title="Recent direct messages">
      {isPending ? (
        <p data-mt="detail-note">Loading…</p>
      ) : recent.length === 0 ? (
        <p data-mt="detail-note">No direct messages with this node yet.</p>
      ) : (
        <ul data-mt="detail-messages">
          {recent.map((m) => (
            <li key={m.id} data-mt="detail-message" data-mt-variant={m.direction}>
              <span data-mt="detail-message-text">{m.text}</span>
              <time dateTime={new Date(m.rxTime).toISOString()} title={formatAbsolute(m.rxTime)}>
                {m.direction === "out" ? "sent " : ""}
                {formatAgo(m.rxTime, Math.max(now, m.rxTime))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Overview tab (CR-001 §5.3): identity, status, power, radio, sensors, position, 24 h. */
export function OverviewTab({ connectionId, node }: { connectionId: number; node: NodeDetailDTO }) {
  const now = useNow();
  const thresholds = useThresholds(connectionId);
  const stale = (time: number) => isStale(time, now, thresholds);
  const device = node.device;
  const level = device?.batteryLevel ?? null;
  const position = node.position;
  const radius = position ? precisionRadiusMeters(position.precisionBits) : null;
  const id = nodeIdFromNum(node.num);
  const { environment, power, air_quality: air } = node.latestTelemetry;
  const directSignal = !node.isSelf && node.hopsAway === 0 && node.snr !== null;

  return (
    <div data-mt="node-drawer-panel" data-mt-variant="overview">
      <Section name="identity" title="Identity">
        <dl data-mt="detail-fields">
          <Field name="long-name" label="Long name">
            {node.longName || NA}
          </Field>
          <Field name="short-name" label="Short name">
            {node.shortName || NA}
          </Field>
          <Field name="id" label="Node ID">
            <CopyButton value={id} label="Copy node ID">
              {id}
            </CopyButton>
          </Field>
          <Field name="num" label="Node number">
            {node.num} (0x{node.num.toString(16).padStart(8, "0")})
          </Field>
          <Field name="hardware" label="Hardware">
            {node.hwModel === null ? NA : hardwareLabel(node.hwModel)}
          </Field>
          <Field name="role" label="Role">
            {node.role === null ? NA : roleLabel(node.role)}
          </Field>
          {node.firmware && (
            <Field name="firmware" label="Firmware">
              {node.firmware}
            </Field>
          )}
          <Field
            name="public-key"
            label={
              <>
                Public key{" "}
                <InfoTip
                  label="public key"
                  text="The first 8 bytes of the node's PKI key. With a key, direct messages to it are end-to-end encrypted; without one they use the channel key."
                />
              </>
            }
          >
            {node.publicKeyFingerprint && node.publicKey ? (
              <CopyButton value={node.publicKey} label="Copy public key" what="the public key">
                {node.publicKeyFingerprint}
              </CopyButton>
            ) : (
              "None shared"
            )}
          </Field>
          <Field name="pki" label="PKI capable">
            {node.publicKey ? "Yes" : "No"}
          </Field>
        </dl>
      </Section>

      <Section name="status" title="Status">
        <dl data-mt="detail-fields">
          <Field
            name="last-heard"
            label={
              <>
                Last heard{" "}
                <InfoTip
                  label="last heard"
                  text="When a packet from this node last reached my node. A quiet node may still be reachable; it may simply not be transmitting."
                />
              </>
            }
          >
            {node.lastHeard === null ? (
              "Never"
            ) : (
              <>
                {formatAgo(node.lastHeard, Math.max(now, node.lastHeard))}{" "}
                <span data-mt="detail-age">({formatAbsolute(node.lastHeard)})</span>
              </>
            )}
          </Field>
          <Field name="first-seen" label="First seen">
            {node.firstSeen === null ? NA : formatAbsolute(node.firstSeen)}
          </Field>
          {!node.isSelf && (
            <>
              <Field name="hops" label="Hops">
                {hopsText(node.hopsAway)}
              </Field>
              <Field name="mqtt" label="Via MQTT">
                {node.viaMqtt ? "Yes (last packet came through a gateway)" : "No"}
              </Field>
            </>
          )}
          <Field name="favorite" label="Favorite">
            {node.isFavorite ? "Yes" : "No"}
          </Field>
          {node.isIgnored && (
            <Field name="ignored" label="Ignored">
              Yes (ignored on the device)
            </Field>
          )}
        </dl>
      </Section>

      <Section name="power" title="Power">
        <dl data-mt="detail-fields">
          <Field name="battery" label="Battery">
            <BatteryMeter level={level} />{" "}
            {level === null ? "Unknown" : level > 100 ? "Powered" : `${level}%`}
            {device && level !== null && (
              <>
                {" "}
                <Reported time={device.time} now={now} stale={stale(device.time)} />
              </>
            )}
          </Field>
          <Field name="voltage" label="Voltage">
            {device?.voltage == null ? NA : `${device.voltage.toFixed(2)} V`}
          </Field>
          <Field name="uptime" label="Uptime">
            {device?.uptimeSeconds == null ? NA : formatDuration(device.uptimeSeconds)}
          </Field>
        </dl>
      </Section>

      <Section name="radio" title="Radio">
        <dl data-mt="detail-fields">
          <Field
            name="utilization"
            label={
              <>
                Channel util{" "}
                <InfoTip
                  label="channel utilization"
                  text="As reported by this node: how busy it hears the channel."
                />
              </>
            }
          >
            {device?.channelUtil == null ? NA : formatPercent(device.channelUtil)}
          </Field>
          <Field name="air-util-tx" label="Air util TX">
            {device?.airUtilTx == null ? NA : formatPercent(device.airUtilTx)}
          </Field>
          {!node.isSelf && (
            <Field
              name="signal"
              label={
                <>
                  Signal{" "}
                  <InfoTip
                    label="signal"
                    text="SNR and RSSI of the last packet my node heard directly from this node, not a continuous measurement."
                  />
                </>
              }
            >
              {directSignal ? (
                <>
                  <SignalBars snr={node.snr ?? 0} /> SNR {node.snr} dB
                  {node.rssi !== null && ` · RSSI ${node.rssi} dBm`}
                </>
              ) : (
                NA
              )}
            </Field>
          )}
        </dl>
      </Section>

      {environment && Object.keys(environment.metrics).length > 0 && (
        <Section name="environment" title="Environment">
          <MetricFields report={environment} />
          <Reported time={environment.time} now={now} stale={stale(environment.time)} />
        </Section>
      )}
      {power && Object.keys(power.metrics).length > 0 && (
        <Section name="power-monitor" title="Power monitor">
          <MetricFields report={power} />
          <Reported time={power.time} now={now} stale={stale(power.time)} />
        </Section>
      )}
      {air && Object.keys(air.metrics).length > 0 && (
        <Section name="air-quality" title="Air quality">
          <MetricFields report={air} />
          <Reported time={air.time} now={now} stale={stale(air.time)} />
        </Section>
      )}

      <Section name="location" title="Position">
        <MiniMap position={position} isSelf={node.isSelf} num={node.num} />
        {position && (
          <dl data-mt="detail-fields">
            <Field name="coordinates" label="Coordinates">
              <CopyButton
                value={`${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`}
                label="Copy coordinates"
                what="the coordinates"
              >
                {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
              </CopyButton>
            </Field>
            <Field name="precision" label="Precision">
              {radius === null ? "Exact" : `Approximate, ±${formatDistance(radius)}`}
            </Field>
            <Field name="altitude" label="Altitude">
              {position.alt === null ? NA : `${position.alt} m`}
            </Field>
            {!node.isSelf && (
              <Field name="distance" label="From my node">
                {node.origin
                  ? `${formatDistance(haversineMeters(node.origin, position))} ${cardinal(bearingDegrees(node.origin, position))}`
                  : NA}
              </Field>
            )}
            <Field name="position-time" label="Position">
              <Reported time={position.time} now={now} stale={stale(position.time)} />
            </Field>
          </dl>
        )}
        {position && (
          <Link
            to="/map"
            search={{ focus: nodeIdFromNum(node.num) }}
            data-mt="button"
            data-mt-variant="show-on-map"
          >
            <MapPin data-mt="icon" {...ICON} />
            Show on map
          </Link>
        )}
      </Section>

      <Section name="stats" title="Last 24 hours">
        <dl data-mt="detail-fields">
          {!node.isSelf && (
            <Field name="packets" label="Packets heard">
              {node.stats24h.packets}
            </Field>
          )}
          {!node.isSelf && (
            <Field name="messages" label="Messages from it">
              {node.stats24h.messages}
            </Field>
          )}
          <Field name="battery-range" label="Battery range">
            {node.stats24h.batteryMin === null || node.stats24h.batteryMax === null
              ? NA
              : `${node.stats24h.batteryMin}–${node.stats24h.batteryMax}%`}
          </Field>
        </dl>
      </Section>

      {!node.isSelf && <RecentMessages connectionId={connectionId} num={node.num} />}
    </div>
  );
}
