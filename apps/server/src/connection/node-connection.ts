import { EventEmitter } from "node:events";
import type {
  Channel,
  Config,
  FromRadio,
  Mesh,
  ModuleConfig,
  ToRadioInit,
} from "@meshterm/protocol";
import type { Connection, ConnectionState } from "@meshterm/shared";
import { systemClock, type Clock, type Random } from "../clock.js";
import { Heartbeat } from "../transport/heartbeat.js";
import type { Transport, TransportClose, TransportFactory } from "../transport/transport.js";
import { backoffDelay, DEFAULT_JITTER } from "./backoff.js";
import { ConnectionStateMachine, type StateChange } from "./state-machine.js";

export interface ConnectionTiming {
  /** How long to wait for the matching `config_complete_id`. */
  configTimeoutMs: number;
  heartbeatIntervalMs: number;
  backoffMinMs: number;
  backoffMaxMs: number;
  /** ±fraction applied to each backoff delay; defaults to {@link DEFAULT_JITTER}. */
  backoffJitter?: number;
  /** How long a link must stay connected before the backoff resets; defaults to {@link STABLE_AFTER_MS}. */
  stableAfterMs?: number;
}

/**
 * A link counts as healthy only after staying up this long. Until then a drop keeps
 * backing off, so a node that accepts and then closes (e.g. because another API client
 * took over its single TCP slot) isn't asked for a full config dump every 2 s.
 */
export const STABLE_AFTER_MS = 30_000;

export interface NodeConnectionOptions {
  connection: Connection;
  /** Called once per connection attempt; transports are single-use. */
  createTransport: TransportFactory;
  timing: ConnectionTiming;
  clock?: Clock;
  random?: Random;
}

/** What the node told us during the last completed handshake, plus later updates. */
export interface NodeModel {
  myNodeNum: number | null;
  myInfo: Mesh.MyNodeInfo | null;
  metadata: Mesh.DeviceMetadata | null;
  nodes: Map<number, Mesh.NodeInfo>;
  channels: Map<number, Channel.Channel>;
  /** Every `Config` section the node sent, by its oneof case (`device`, `lora`, …). */
  config: Map<string, Config.Config>;
  /** Every `ModuleConfig` section, by its oneof case (`mqtt`, `telemetry`, …). */
  moduleConfig: Map<string, ModuleConfig.ModuleConfig>;
}

export interface RetryScheduled {
  /** Consecutive failures so far, counting the one that scheduled this retry. */
  failures: number;
  delayMs: number;
}

export interface NodeConnectionEvents {
  state: [StateChange];
  /** Every `FromRadio` from the node, in order, including the handshake. */
  fromRadio: [FromRadio];
  retry: [RetryScheduled];
  /** The node answered on its alternate address, which is now the connection's. */
  addressChanged: [{ host: string }];
}

export class NotConnectedError extends Error {
  constructor(readonly state: ConnectionState) {
    super(`node is ${state}, not connected`);
    this.name = "NotConnectedError";
  }
}

/** Firmware treats these `want_config_id` values specially (config-only, nodes-only). */
const SPECIAL_NONCES = new Set([69420, 69421]);

function emptyModel(): NodeModel {
  return {
    myNodeNum: null,
    myInfo: null,
    metadata: null,
    nodes: new Map(),
    channels: new Map(),
    config: new Map(),
    moduleConfig: new Map(),
  };
}

/**
 * Keeps one node connected: transport, config handshake, heartbeat and reconnect
 * with backoff. It never transmits on the mesh; it only sends `want_config_id`
 * and heartbeats.
 */
export class NodeConnection extends EventEmitter<NodeConnectionEvents> {
  private conn: Connection;
  private readonly createTransport: TransportFactory;
  /** A second address to try (a new static IP after a network change, CR-002 §7.1). */
  private alternateHost: string | null = null;
  private attempts = 0;
  private attemptHost: string | null = null;
  private readonly timing: ConnectionTiming;
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly machine = new ConnectionStateMachine();

  private transport: Transport | null = null;
  private heartbeat: Heartbeat | null = null;
  private cancelConfigTimer: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private cancelStableTimer: (() => void) | null = null;
  private connectedAt: number | null = null;
  private nonce = 0;
  private pending: NodeModel = emptyModel();
  private current: NodeModel = emptyModel();
  private failures = 0;
  private enteredStateAt: number;

  constructor(options: NodeConnectionOptions) {
    super();
    this.conn = options.connection;
    this.createTransport = options.createTransport;
    this.timing = options.timing;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.enteredStateAt = this.clock.now();
    this.machine.on("change", (change) => {
      this.enteredStateAt = this.clock.now();
      this.emit("state", change);
    });
  }

  get connection(): Connection {
    return this.conn;
  }

  /**
   * Also try `host` from now on: attempts alternate between the connection's address
   * and this one until one completes a handshake. If the alternate one does, it becomes
   * the connection's address and `addressChanged` fires (the app saves it).
   */
  tryAlternateHost(host: string | null): void {
    this.alternateHost = host && host !== this.conn.host ? host : null;
  }

  get pendingAlternateHost(): string | null {
    return this.alternateHost;
  }

  get state(): ConnectionState {
    return this.machine.state;
  }

  /** When the connection entered its current state (epoch ms); e.g. "connected since". */
  get stateSince(): number {
    return this.enteredStateAt;
  }

  /** The model from the last completed handshake (empty before the first one). */
  get model(): Readonly<NodeModel> {
    return this.current;
  }

  /** Starts connecting. No-op unless disconnected. */
  start(): void {
    if (this.state !== "disconnected") return;
    void this.attempt("start");
  }

  /**
   * Sends one `ToRadio` over the live link. Throws {@link NotConnectedError} unless
   * connected. This is the only way anything outside the handshake and heartbeat
   * reaches the node, so every caller is a deliberate transmit.
   */
  send(message: ToRadioInit): void {
    if (this.state !== "connected" || !this.transport) throw new NotConnectedError(this.state);
    this.transport.send(message);
  }

  /**
   * Drops the current link (if any) and connects again right away, with the backoff
   * reset: a user-requested retry. Sends nothing but the usual handshake.
   */
  async reconnect(): Promise<void> {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.failures = 0;
    const closing = this.teardownLink();
    const active =
      this.state === "connecting" || this.state === "configuring" || this.state === "connected";
    if (active) this.machine.transition("reconnecting", "reconnect requested");
    await closing;
    void this.attempt("reconnect requested");
  }

  /** Drops the link, cancels any pending retry, and goes to `disconnected`. */
  async stop(): Promise<void> {
    this.cancelRetry?.();
    this.cancelRetry = null;
    const closing = this.teardownLink();
    if (this.state !== "disconnected") this.machine.transition("disconnected", "stopped");
    await closing;
  }

  private async attempt(reason: string): Promise<void> {
    this.machine.transition("connecting", reason);
    // With an alternate address: the usual one first, then every other attempt the new one.
    this.attempts++;
    this.attemptHost = this.alternateHost && this.attempts % 2 === 0 ? this.alternateHost : null;
    const transport = this.attemptHost
      ? this.createTransport(this.attemptHost)
      : this.createTransport();
    this.transport = transport;
    transport.on("fromRadio", (message) => {
      if (this.transport === transport) this.onFromRadio(message);
    });
    transport.on("close", (info) => {
      if (this.transport === transport) this.fail(this.withShortLinkHint(describeClose(info)));
    });
    transport.on("error", () => {
      // Informational; a fatal error is followed by `close`. Logged from Phase 7.
    });

    try {
      await transport.connect();
    } catch (err) {
      if (this.transport === transport) this.fail(`connect failed: ${errorMessage(err)}`);
      return;
    }
    // stop() may have run while we were connecting.
    if (this.transport !== transport) return;

    this.nonce = this.newNonce();
    this.pending = emptyModel();
    try {
      transport.send({ payloadVariant: { case: "wantConfigId", value: this.nonce } });
    } catch (err) {
      this.fail(`send want_config_id failed: ${errorMessage(err)}`);
      return;
    }
    this.machine.transition("configuring", `want_config_id ${this.nonce}`);
    const { configTimeoutMs } = this.timing;
    this.cancelConfigTimer = this.clock.setTimer(configTimeoutMs, () => {
      this.cancelConfigTimer = null;
      this.fail(`no config_complete_id ${this.nonce} within ${configTimeoutMs} ms`);
    });
  }

  private onFromRadio(message: FromRadio): void {
    this.emit("fromRadio", message);
    const variant = message.payloadVariant;
    if (this.state === "configuring") {
      if (variant.case !== "configCompleteId") applyToModel(this.pending, variant);
      else if (variant.value === this.nonce) this.completeHandshake();
      // A config_complete_id for some other nonce is ignored.
    } else if (this.state === "connected") {
      applyToModel(this.current, variant);
    }
  }

  private completeHandshake(): void {
    this.cancelConfigTimer?.();
    this.cancelConfigTimer = null;
    this.current = this.pending;
    this.pending = emptyModel();
    this.connectedAt = this.clock.now();
    this.cancelStableTimer = this.clock.setTimer(
      this.timing.stableAfterMs ?? STABLE_AFTER_MS,
      () => {
        this.cancelStableTimer = null;
        this.failures = 0;
      },
    );
    if (this.attemptHost) {
      const host = this.attemptHost;
      this.conn = { ...this.conn, host };
      this.alternateHost = null;
      this.attemptHost = null;
      this.emit("addressChanged", { host });
    } else {
      this.alternateHost = null;
    }
    this.attempts = 0;
    this.machine.transition("connected", `config_complete_id ${this.nonce}`);
    const transport = this.transport;
    if (transport) {
      this.heartbeat = new Heartbeat(transport, this.timing.heartbeatIntervalMs, this.clock);
      this.heartbeat.start();
    }
  }

  /** Any failure in an active state: drop the link and schedule the next attempt. */
  private fail(reason: string): void {
    void this.teardownLink();
    this.machine.transition("reconnecting", reason);
    const delayMs = backoffDelay(
      this.failures,
      {
        minMs: this.timing.backoffMinMs,
        maxMs: this.timing.backoffMaxMs,
        jitter: this.timing.backoffJitter ?? DEFAULT_JITTER,
      },
      this.random,
    );
    this.failures++;
    this.emit("retry", { failures: this.failures, delayMs });
    this.cancelRetry = this.clock.setTimer(delayMs, () => {
      this.cancelRetry = null;
      void this.attempt(`retry ${this.failures}`);
    });
  }

  /** Explains a link the node closed soon after the handshake: usually a second API client. */
  private withShortLinkHint(reason: string): string {
    if (this.state !== "connected" || this.connectedAt === null || !this.cancelStableTimer) {
      return reason;
    }
    const ms = this.clock.now() - this.connectedAt;
    return `${reason} ${ms} ms after connecting; is another app (phone, Home Assistant, another MeshTerm) connected to this node over TCP? The node allows one TCP client at a time`;
  }

  private teardownLink(): Promise<void> {
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.cancelStableTimer?.();
    this.cancelStableTimer = null;
    this.connectedAt = null;
    this.cancelConfigTimer?.();
    this.cancelConfigTimer = null;
    const transport = this.transport;
    this.transport = null;
    if (!transport) return Promise.resolve();
    return transport.disconnect().finally(() => {
      transport.removeAllListeners();
    });
  }

  /** Random non-zero uint32 that the firmware won't read as a special request. */
  private newNonce(): number {
    let nonce = Math.floor(this.random() * 0xffff_fffe) + 1;
    while (SPECIAL_NONCES.has(nonce)) nonce++;
    return nonce;
  }
}

function applyToModel(model: NodeModel, variant: FromRadio["payloadVariant"]) {
  switch (variant.case) {
    case "myInfo":
      model.myInfo = variant.value;
      model.myNodeNum = variant.value.myNodeNum;
      break;
    case "metadata":
      model.metadata = variant.value;
      break;
    case "nodeInfo":
      model.nodes.set(variant.value.num, variant.value);
      break;
    case "channel":
      model.channels.set(variant.value.index, variant.value);
      break;
    case "config":
      if (variant.value.payloadVariant.case) {
        model.config.set(variant.value.payloadVariant.case, variant.value);
      }
      break;
    case "moduleConfig":
      if (variant.value.payloadVariant.case) {
        model.moduleConfig.set(variant.value.payloadVariant.case, variant.value);
      }
      break;
    default:
      break;
  }
}

function describeClose(info: TransportClose): string {
  return info.error
    ? `link closed (${info.reason}): ${info.error.message}`
    : `link closed (${info.reason})`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
