import {
  HISTORY_WINDOWS,
  type HistoryWindow,
  type NodeCard,
  type NodeHistory,
} from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Copy, MessageSquare, Star, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { InfoTip } from "../components/InfoTip.js";
import { TimeChart, type ChartSeries } from "../components/TimeChart.js";
import { useNow } from "../components/useNow.js";
import { useConversation, useDashboard, useNodeHistory } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { useUiStore } from "../data/ui-store.js";
import { BatteryMeter } from "./BatteryMeter.js";
import {
  formatAbsolute,
  formatAgo,
  formatDuration,
  formatEnvironment,
  formatPercent,
} from "./format.js";
import {
  bearingDegrees,
  cardinal,
  formatDistance,
  haversineMeters,
  precisionRadiusMeters,
} from "./geo.js";
import { ageLabel, isStale, STATUS_LABELS } from "./insights.js";
import { hardwareLabel, roleLabel } from "./labels.js";
import { MiniMap } from "./MiniMap.js";
import { SignalBars } from "./SignalBars.js";
import { useToggleFavorite } from "./useFavorite.js";
import { nodeStatus } from "./view.js";

const NA = "Not available";

function Field({ name, label, children }: { name: string; label: ReactNode; children: ReactNode }) {
  return (
    <div data-mt="detail-field" data-mt-variant={name}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <section data-mt="detail-section" data-mt-variant={name}>
      <h3 data-mt="detail-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** "reported 3 min ago" with the stale age label when old. */
function Reported({ time, now, stale }: { time: number; now: number; stale: boolean }) {
  return (
    <span data-mt={stale ? "stale-note" : "detail-age"} title={formatAbsolute(time)}>
      {stale ? `reported ${ageLabel(time, now)}` : `reported ${formatAgo(time, now)}`}
    </span>
  );
}

export function historySeries(history: NodeHistory): {
  times: number[];
  series: ChartSeries[];
} {
  const times = history.device.map((d) => d.time);
  return {
    times,
    series: [
      {
        id: "battery",
        label: "Battery",
        kind: "line",
        axis: "left",
        color: "--mt-chart-1",
        // External power reads as > 100: not a battery level.
        values: history.device.map((d) =>
          d.batteryLevel === null || d.batteryLevel > 100 ? null : d.batteryLevel,
        ),
        format: (v) => `${Math.round(v)}%`,
      },
      {
        id: "channel-util",
        label: "Channel util",
        kind: "line",
        axis: "right",
        color: "--mt-status-warn",
        values: history.device.map((d) => d.channelUtil),
        format: formatPercent,
      },
    ],
  };
}

function HistoryChart({ connectionId, card }: { connectionId: number; card: NodeCard }) {
  const [range, setRange] = useState<HistoryWindow>("24h");
  const now = useNow();
  const { data, isPending, isError } = useNodeHistory(connectionId, card.num, range);
  const span = range === "24h" ? 24 * 3600_000 : 7 * 24 * 3600_000;
  return (
    <Section name="history" title="Telemetry history">
      <div
        data-mt="history-window"
        data-mt-variant="segmented"
        role="group"
        aria-label="History window"
      >
        {HISTORY_WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            data-mt="segment"
            data-mt-variant={w}
            data-mt-state={w === range ? "active" : "inactive"}
            aria-pressed={w === range}
            onClick={() => {
              setRange(w);
            }}
          >
            {w === "24h" ? "24 h" : "7 d"}
          </button>
        ))}
      </div>
      {isPending ? (
        <div data-mt="skeleton" data-mt-variant="chart" aria-hidden />
      ) : isError ? (
        <p role="alert">History couldn&apos;t be loaded.</p>
      ) : (
        <>
          <TimeChart
            label={`${card.longName || card.userId}: battery and channel utilization`}
            summary={`${data.device.length} device reports stored in this window.`}
            {...historySeries(data)}
            from={now - span}
            to={now}
            leftMax={100}
            formatTime={(t) => format(t, range === "7d" ? "EEE HH:mm" : "HH:mm")}
            emptyText="No device telemetry stored for this node in this window."
          />
          {data.environment.length > 0 && (
            <p data-mt="detail-note">
              {data.environment.length} environment reports stored; latest{" "}
              {formatEnvironment(
                data.environment.at(-1) ?? { temperature: null, humidity: null, pressure: null },
              ) ?? NA}
              .
            </p>
          )}
          {data.positions.length > 1 && (
            <p data-mt="detail-note">{data.positions.length} position reports stored.</p>
          )}
        </>
      )}
    </Section>
  );
}

function RecentMessages({ connectionId, card }: { connectionId: number; card: NodeCard }) {
  const now = useNow();
  const { data, isPending } = useConversation(connectionId, { peer: card.num });
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
                {formatAgo(m.rxTime, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Details({
  connectionId,
  card,
  cards,
}: {
  connectionId: number;
  card: NodeCard;
  cards: readonly NodeCard[];
}) {
  const now = useNow();
  const thresholds = useDashboard(connectionId).data?.thresholds;
  const toggleFavorite = useToggleFavorite(connectionId);
  const toast = useUiStore((s) => s.toast);
  const close = useUiStore((s) => s.closeNode);
  if (!thresholds) return null;
  const status = nodeStatus(card.lastHeard, now, thresholds);
  const name = card.longName || card.shortName || card.userId;
  const device = card.device;
  const level = device?.batteryLevel ?? null;
  const origin = cards.find((c) => c.isSelf)?.position ?? null;
  const position = card.position;
  const radius = position ? precisionRadiusMeters(position.precisionBits) : null;
  const stale = (time: number) => isStale(time, now, thresholds);

  return (
    <>
      <header data-mt="node-drawer-header">
        <span data-mt="status-dot" data-mt-state={status} aria-hidden />
        <div data-mt="node-drawer-names">
          <Dialog.Title data-mt="node-drawer-title">{name}</Dialog.Title>
          <Dialog.Description data-mt="node-drawer-subtitle">
            {card.shortName} · {STATUS_LABELS[status]}
            {card.isSelf ? " · My node" : ""}
          </Dialog.Description>
        </div>
        <button
          type="button"
          data-mt="favorite-toggle"
          data-mt-state={card.isFavorite ? "on" : "off"}
          aria-pressed={card.isFavorite}
          aria-label={card.isFavorite ? `Unfavorite ${name}` : `Favorite ${name}`}
          onClick={() => {
            void toggleFavorite(card.num, !card.isFavorite);
          }}
        >
          <Star data-mt="icon" aria-hidden focusable={false} />
        </button>
        <Dialog.Close asChild>
          <button type="button" data-mt="icon-button" aria-label="Close details">
            <X data-mt="icon" aria-hidden focusable={false} />
          </button>
        </Dialog.Close>
      </header>

      {!card.isSelf && (
        <div data-mt="node-drawer-actions">
          <Link
            to="/dm/$nodeNum"
            params={{ nodeNum: String(card.num) }}
            data-mt="button"
            data-mt-variant="message"
            onClick={close}
          >
            <MessageSquare data-mt="icon" aria-hidden focusable={false} />
            Send a direct message
          </Link>
        </div>
      )}

      <div data-mt="node-drawer-body">
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
              {card.lastHeard === null ? (
                "Never"
              ) : (
                <>
                  {formatAgo(card.lastHeard, now)}{" "}
                  <span data-mt="detail-age">({formatAbsolute(card.lastHeard)})</span>
                </>
              )}
            </Field>
            {!card.isSelf && (
              <>
                <Field name="hops" label="Hops">
                  {card.hopsAway === null
                    ? NA
                    : card.hopsAway === 0
                      ? "Heard directly"
                      : `${card.hopsAway} ${card.hopsAway === 1 ? "hop" : "hops"} (route not known)`}
                </Field>
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
                  {card.hopsAway === 0 && card.snr !== null ? (
                    <>
                      <SignalBars snr={card.snr} /> SNR {card.snr} dB
                      {card.rssi !== null && ` · RSSI ${card.rssi} dBm`}
                    </>
                  ) : (
                    NA
                  )}
                </Field>
              </>
            )}
          </dl>
        </Section>

        <Section name="identity" title="Identity">
          <dl data-mt="detail-fields">
            <Field name="id" label="Node ID">
              <button
                type="button"
                data-mt="copy-id"
                onClick={() => {
                  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing over plain HTTP
                  navigator.clipboard?.writeText(card.userId).then(
                    () => {
                      toast(`Copied ${card.userId}`, "success");
                    },
                    () => undefined,
                  );
                }}
              >
                {card.userId} <Copy data-mt="icon" aria-hidden focusable={false} />
              </button>
            </Field>
            <Field name="num" label="Node number">
              {card.num}
            </Field>
            <Field name="role" label="Role">
              {card.role === null ? NA : roleLabel(card.role)}
            </Field>
            <Field name="hardware" label="Hardware">
              {card.hwModel === null ? NA : hardwareLabel(card.hwModel)}
            </Field>
          </dl>
        </Section>

        <Section name="power" title="Power">
          <dl data-mt="detail-fields">
            <Field name="battery" label="Battery">
              <BatteryMeter level={level} />{" "}
              {level === null ? "Unknown" : level > 100 ? "External power" : `${level}%`}
              {device?.voltage != null && ` · ${device.voltage.toFixed(2)} V`}
              {device && level !== null && (
                <>
                  {" "}
                  <Reported time={device.time} now={now} stale={stale(device.time)} />
                </>
              )}
            </Field>
            <Field name="uptime" label="Uptime">
              {device?.uptimeSeconds == null ? NA : formatDuration(device.uptimeSeconds)}
            </Field>
            <Field
              name="utilization"
              label={
                <>
                  Utilization{" "}
                  <InfoTip
                    label="utilization"
                    text="As reported by this node: channel utilization is how busy it hears the channel; air util TX is its own transmit share over the last hour."
                  />
                </>
              }
            >
              {device?.channelUtil == null && device?.airUtilTx == null
                ? NA
                : [
                    device.channelUtil == null
                      ? null
                      : `Channel ${formatPercent(device.channelUtil)}`,
                    device.airUtilTx == null ? null : `Air TX ${formatPercent(device.airUtilTx)}`,
                  ]
                    .filter((p) => p !== null)
                    .join(" · ")}
            </Field>
          </dl>
        </Section>

        <Section name="location" title="Location">
          <MiniMap position={position} isSelf={card.isSelf} />
          {position && (
            <dl data-mt="detail-fields">
              <Field name="coordinates" label="Coordinates">
                {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
                {radius !== null && ` (approximate, ±${formatDistance(radius)})`}
              </Field>
              <Field name="altitude" label="Altitude">
                {position.alt === null ? NA : `${position.alt} m`}
              </Field>
              {!card.isSelf && (
                <Field name="distance" label="From my node">
                  {origin
                    ? `${formatDistance(haversineMeters(origin, position))} ${cardinal(bearingDegrees(origin, position))}`
                    : NA}
                </Field>
              )}
              <Field name="position-time" label="Position">
                <Reported time={position.time} now={now} stale={stale(position.time)} />
              </Field>
            </dl>
          )}
        </Section>

        {card.environment && (
          <Section name="environment" title="Environment">
            <p>
              {formatEnvironment(card.environment) ?? NA}{" "}
              <Reported
                time={card.environment.time}
                now={now}
                stale={stale(card.environment.time)}
              />
            </p>
          </Section>
        )}

        <HistoryChart connectionId={connectionId} card={card} />
        {!card.isSelf && <RecentMessages connectionId={connectionId} card={card} />}
      </div>
    </>
  );
}

/** Side drawer with everything known about the selected node; opened from any page. */
export function NodeDetailsDrawer() {
  const selected = useUiStore((s) => s.selectedNode);
  const close = useUiStore((s) => s.closeNode);
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data } = useDashboard(selected === null ? null : connectionId);
  const card = data?.nodes.find((c) => c.num === selected) ?? null;
  const open = selected !== null && card !== null && connectionId !== null;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content data-mt="node-drawer" data-node-num={selected ?? undefined}>
          {open && <Details connectionId={connectionId} card={card} cards={data?.nodes ?? []} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
