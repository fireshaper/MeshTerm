import { nodeIdFromNum, type LatestTelemetry, type NodeDetailDTO } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
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
import { useChannels, useMessagesFrom } from "../data/queries.js";
import { useThresholds } from "../messages/useNodeMap.js";
import { formatMetric, metricInfo, orderedMetrics } from "./metrics.js";
import { detailNotes } from "./notes.js";
import { BearingArrow } from "../dashboard/BearingArrow.js";
import { channelDisplayName } from "@meshterm/shared";
import type { DashboardThresholds } from "@meshterm/shared";
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

/** What this node said lately, on any channel or to us (CR-005 §6.6). */
function RecentMessages({ connectionId, num }: { connectionId: number; num: number }) {
  const now = useNow();
  const { data, isPending } = useMessagesFrom(connectionId, num);
  const { data: channels } = useChannels(connectionId);
  const where = (channel: number, peer: number | null) => {
    if (peer !== null) return "DM";
    const c = Array.isArray(channels) ? channels.find((x) => x.index === channel) : undefined;
    return `CH ${channel}${c ? ` · ${channelDisplayName(c, null)}` : ""}`;
  };
  const recent = Array.isArray(data) ? data : [];
  return (
    <Section name="messages" title="Recent messages from this node">
      {isPending ? (
        <p data-mt="detail-note">Loading…</p>
      ) : recent.length === 0 ? (
        <p data-mt="detail-note">No messages from this node yet.</p>
      ) : (
        <ul data-mt="detail-messages">
          {recent.map((m) => (
            <li
              key={m.id}
              data-mt="detail-message"
              data-mt-variant={m.peer === null ? "channel" : "dm"}
            >
              <span data-mt="detail-message-where">{where(m.channelIndex, m.peer)}</span>
              <span data-mt="detail-message-text">{m.text}</span>
              <time dateTime={new Date(m.rxTime).toISOString()} title={formatAbsolute(m.rxTime)}>
                {formatAgo(m.rxTime, Math.max(now, m.rxTime))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The nine numbers at the top of the Overview (CR-005 §6.6). */
function StatGrid({ node, now }: { node: NodeDetailDTO; now: number }) {
  const device = node.device;
  const level = device?.batteryLevel ?? null;
  const at = node.origin && node.position && !node.isSelf ? node.position : null;
  const bearing = at && node.origin ? bearingDegrees(node.origin, at) : null;
  const direct = !node.isSelf && node.hopsAway === 0;
  const stats: [string, string, ReactNode][] = [
    [
      "last-heard",
      "Last heard",
      node.lastHeard === null ? "Never" : formatAgo(node.lastHeard, Math.max(now, node.lastHeard)),
    ],
    [
      "hops",
      "Hops",
      node.isSelf
        ? "—"
        : node.hopsAway === null
          ? "?"
          : node.hopsAway === 0
            ? "Direct"
            : node.hopsAway,
    ],
    ["snr", "SNR", direct && node.snr !== null ? `${node.snr} dB` : "—"],
    ["rssi", "RSSI", direct && node.rssi !== null ? `${node.rssi} dBm` : "—"],
    [
      "distance",
      "Distance",
      at && node.origin ? formatDistance(haversineMeters(node.origin, at)) : "—",
    ],
    ["bearing", "Bearing", bearing === null ? "—" : <BearingArrow degrees={bearing} />],
    ["battery", "Battery", level === null ? "—" : level > 100 ? "Powered" : `${level}%`],
    [
      "channel-util",
      "Ch util",
      device?.channelUtil == null ? "—" : formatPercent(device.channelUtil),
    ],
    [
      "uptime",
      "Uptime",
      device?.uptimeSeconds == null ? "—" : formatDuration(device.uptimeSeconds),
    ],
  ];
  return (
    <dl data-mt="detail-stats">
      {stats.map(([variant, label, value]) => (
        <div key={variant} data-mt="detail-stat" data-mt-variant={variant}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notes({
  node,
  now,
  thresholds,
}: {
  node: NodeDetailDTO;
  now: number;
  thresholds: DashboardThresholds;
}) {
  const notes = detailNotes(node, now, thresholds);
  if (notes.length === 0) return null;
  return (
    <div data-mt="detail-notes">
      {notes.map((n) => (
        <p key={n.kind} data-mt="detail-note" data-mt-variant={n.kind} role="note">
          {n.text}
        </p>
      ))}
    </div>
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
      <StatGrid node={node} now={now} />
      <Notes node={node} now={now} thresholds={thresholds} />
      <Section name="identity" title="Device">
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
        {position && node.origin && !node.isSelf && (
          <p data-mt="detail-where">
            {formatDistance(haversineMeters(node.origin, position))}{" "}
            {cardinal(bearingDegrees(node.origin, position))} of you
          </p>
        )}
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
