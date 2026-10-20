import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import {
  create,
  decodeToRadio,
  encodeFrame,
  encodeFromRadio,
  type FromRadioVariant,
  Mesh,
  type MessageInitShape,
  Portnums,
  StreamFramer,
  Telemetry,
  toBinary,
  type ToRadio,
} from "@meshterm/protocol";
import { BROADCAST_NUM } from "@meshterm/shared";
import { loadScenario, type Scenario, type ScenarioNode } from "./scenario.js";

export interface FakeNodeOptions {
  /** TCP port; 0 (default) picks a free one, readable from `port` after `start()`. */
  port?: number;
  host?: string;
  /** Clock in epoch ms; injectable for deterministic tests. */
  now?: () => number;
  /** The mesh to pretend to be: a built-in scenario name, a JSON path, or a parsed scenario. */
  scenario?: Scenario | string;
}

/** How FakeNode answers outgoing text: routing ACK, routing error (NAK), or nothing. */
export type AckMode = "ack" | "nak" | "silent";

/**
 * How FakeNode ends its handshake reply: echo the nonce (real behavior), answer
 * with a different id, or send no `config_complete_id` at all.
 */
export type ConfigCompleteMode = "echo" | "wrong" | "none";

/** Where an injected text goes: a channel broadcast or a DM to one node. */
export type TextTarget = { channel: number } | { to: number };

export interface InjectTextOptions {
  rxSnr?: number;
  rxRssi?: number;
  /** Hops the packet took to reach us; sets `hopStart - hopLimit`. */
  hopsAway?: number;
  /** Reuse a packet id, e.g. to simulate hearing a rebroadcast of the same packet. */
  packetId?: number;
}

export type TelemetryInit = MessageInitShape<typeof Telemetry.TelemetrySchema>;
export type PositionInit = MessageInitShape<typeof Mesh.PositionSchema>;

export type NodeInfoInit = MessageInitShape<typeof Mesh.NodeInfoSchema> & { num: number };

export interface InboundEntry {
  /** Epoch ms when the frame was decoded. */
  at: number;
  message: ToRadio;
}

const HOP_START = 3;
const QUEUE_MAXLEN = 16;

/** A TCP server that speaks the Meshtastic stream API, for tests. Never touches a radio. */
export class FakeNode {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly now: () => number;
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  private readonly inboundLog: InboundEntry[] = [];
  private boundPort = 0;
  private readonly scenario: Scenario;
  /** NodeDB keyed by node number; starts from the scenario, updated by injections. */
  private readonly nodeDb = new Map<number, ScenarioNode>();
  private nextFromRadioId = 1;
  /** Packet ids for injected and generated packets; incremented so each is unique. */
  private nextPacketId = 0x1000_0000;
  private rebootCount: number;
  private ackMode: AckMode = "ack";
  private ackDelayMs = 0;
  private configCompleteMode: ConfigCompleteMode = "echo";
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  /** Count of frames that failed to decode as `ToRadio`. */
  decodeErrors = 0;

  constructor(options: FakeNodeOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.now = options.now ?? Date.now;
    const scenario = options.scenario ?? "default";
    this.scenario = typeof scenario === "string" ? loadScenario(scenario) : scenario;
    for (const node of this.scenario.nodes) this.nodeDb.set(node.info.num, node);
    this.rebootCount = this.scenario.myInfo.rebootCount;
  }

  get myNodeNum(): number {
    return this.scenario.myInfo.myNodeNum;
  }

  get scenarioName(): string {
    return this.scenario.name;
  }

  get port(): number {
    return this.boundPort;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Every decoded `ToRadio`, oldest first. */
  get inbound(): readonly InboundEntry[] {
    return this.inboundLog;
  }

  clearInbound(): void {
    this.inboundLog.length = 0;
  }

  async start(): Promise<number> {
    this.stopped = false;
    await this.listen(this.requestedPort);
    return this.boundPort;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.closeServer();
  }

  /** Delivers a text message to every client as if heard over the mesh. Returns its packet id. */
  injectText(
    from: number,
    target: TextTarget,
    text: string,
    options: InjectTextOptions = {},
  ): number {
    return this.injectPacket(
      from,
      target,
      Portnums.PortNum.TEXT_MESSAGE_APP,
      new TextEncoder().encode(text),
      options,
    );
  }

  /**
   * Delivers a TELEMETRY_APP broadcast (device or environment metrics) from `from`.
   * `time` defaults to now. Returns the packet id.
   */
  injectTelemetry(from: number, telemetry: TelemetryInit, options: InjectTextOptions = {}): number {
    const message = create(Telemetry.TelemetrySchema, {
      time: this.nowSeconds(),
      ...telemetry,
    });
    return this.injectPacket(
      from,
      { channel: 0 },
      Portnums.PortNum.TELEMETRY_APP,
      toBinary(Telemetry.TelemetrySchema, message),
      options,
    );
  }

  /**
   * Delivers a POSITION_APP broadcast from `from` (`latitudeI`/`longitudeI` are
   * degrees × 1e7) and records it in the NodeDB for later handshakes. Returns the packet id.
   */
  injectPosition(from: number, position: PositionInit, options: InjectTextOptions = {}): number {
    const message = create(Mesh.PositionSchema, { time: this.nowSeconds(), ...position });
    const known = this.nodeDb.get(from);
    if (known) {
      this.nodeDb.set(from, {
        ...known,
        info: create(Mesh.NodeInfoSchema, { ...known.info, position: message }),
      });
    }
    return this.injectPacket(
      from,
      { channel: 0 },
      Portnums.PortNum.POSITION_APP,
      toBinary(Mesh.PositionSchema, message),
      options,
    );
  }

  /**
   * Delivers a NEIGHBORINFO_APP broadcast from `from`: the nodes it says it hears,
   * with the SNR it measured. Returns the packet id.
   */
  injectNeighborInfo(
    from: number,
    neighbors: { nodeId: number; snr: number }[],
    options: InjectTextOptions = {},
  ): number {
    const message = create(Mesh.NeighborInfoSchema, {
      nodeId: from,
      lastSentById: from,
      nodeBroadcastIntervalSecs: 900,
      neighbors: neighbors.map((n) => ({ nodeId: n.nodeId, snr: n.snr })),
    });
    return this.injectPacket(
      from,
      { channel: 0 },
      Portnums.PortNum.NEIGHBORINFO_APP,
      toBinary(Mesh.NeighborInfoSchema, message),
      options,
    );
  }

  /**
   * Adds or replaces a node in the NodeDB (so later handshakes include it) and
   * delivers its `User` as a `NODEINFO_APP` packet, the way firmware forwards a
   * node announcement it hears. Returns the packet id.
   */
  injectNodeInfo(node: NodeInfoInit): number {
    const info = create(Mesh.NodeInfoSchema, {
      ...node,
      lastHeard: node.lastHeard ?? this.nowSeconds(),
    });
    this.nodeDb.set(info.num, {
      info,
      lastHeardAgoS: null,
      environment: this.nodeDb.get(info.num)?.environment ?? null,
    });
    const id = this.newPacketId();
    const hopsAway = info.hopsAway ?? 0;
    this.broadcast({
      case: "packet",
      value: {
        from: info.num,
        to: BROADCAST_NUM,
        id,
        rxTime: info.lastHeard,
        rxSnr: info.snr,
        hopStart: HOP_START,
        hopLimit: HOP_START - hopsAway,
        payloadVariant: {
          case: "decoded",
          value: {
            portnum: Portnums.PortNum.NODEINFO_APP,
            payload: toBinary(Mesh.UserSchema, info.user ?? create(Mesh.UserSchema)),
          },
        },
      },
    });
    return id;
  }

  /** How to answer outgoing text messages from now on; `delayMs` postpones the answer. */
  setAckMode(mode: AckMode, delayMs = 0): void {
    this.ackMode = mode;
    this.ackDelayMs = delayMs;
  }

  /** How to end later handshake replies; see {@link ConfigCompleteMode}. */
  setConfigCompleteMode(mode: ConfigCompleteMode): void {
    this.configCompleteMode = mode;
  }

  /** Sends an arbitrary `FromRadio` to every client. */
  sendFromRadio(payloadVariant: FromRadioVariant): void {
    this.broadcast(payloadVariant);
  }

  /** Closes every client socket from the node's side but keeps listening. */
  dropClients(): void {
    for (const socket of this.clients) socket.destroy();
    this.clients.clear();
  }

  /**
   * Simulates a node reboot: drops every client, refuses connections for `downMs`,
   * then listens on the same port again. Resolves once it is accepting again.
   */
  async reboot(downMs: number): Promise<void> {
    await this.closeServer();
    this.rebootCount++;
    await new Promise<void>((resolve) => {
      this.later(downMs, resolve);
    });
    if (!this.stopped) await this.listen(this.boundPort);
  }

  /** A decoded packet as if heard over the mesh, sent to every client. */
  private injectPacket(
    from: number,
    target: TextTarget,
    portnum: Portnums.PortNum,
    payload: Uint8Array,
    options: InjectTextOptions,
  ): number {
    const id = options.packetId ?? this.newPacketId();
    this.broadcast(this.packetVariant(id, from, target, portnum, payload, options));
    return id;
  }

  private packetVariant(
    id: number,
    from: number,
    target: TextTarget,
    portnum: Portnums.PortNum,
    payload: Uint8Array,
    options: InjectTextOptions,
  ): FromRadioVariant {
    const hopsAway = options.hopsAway ?? 0;
    return {
      case: "packet",
      value: {
        from,
        to: "to" in target ? target.to : BROADCAST_NUM,
        channel: "channel" in target ? target.channel : 0,
        id,
        rxTime: this.nowSeconds(),
        rxSnr: options.rxSnr ?? 6.25,
        rxRssi: options.rxRssi ?? -72,
        hopStart: HOP_START,
        hopLimit: HOP_START - hopsAway,
        payloadVariant: { case: "decoded", value: { portnum, payload } },
      },
    };
  }

  /** Sends one framed `FromRadio` to every connected client. */
  private broadcast(payloadVariant: FromRadioVariant): void {
    const frame = this.frame(payloadVariant);
    for (const socket of this.clients) socket.write(frame);
  }

  private send(socket: Socket, payloadVariant: FromRadioVariant): void {
    socket.write(this.frame(payloadVariant));
  }

  private frame(payloadVariant: FromRadioVariant): Uint8Array {
    return encodeFrame(encodeFromRadio({ id: this.nextFromRadioId++, payloadVariant }));
  }

  private handle(socket: Socket, message: ToRadio): void {
    const v = message.payloadVariant;
    switch (v.case) {
      case "packet":
        this.handlePacket(socket, v.value);
        break;
      case "wantConfigId":
        this.sendConfig(socket, v.value);
        break;
      case "disconnect":
        socket.end();
        break;
      default:
        break;
    }
  }

  /**
   * Answers a packet from the client the way firmware does: a `queueStatus` naming
   * the packet id, then (for text) a routing reply per the ack mode. Nothing here
   * goes over any mesh.
   */
  private handlePacket(socket: Socket, packet: Mesh.MeshPacket): void {
    this.send(socket, {
      case: "queueStatus",
      value: { res: 0, free: QUEUE_MAXLEN - 1, maxlen: QUEUE_MAXLEN, meshPacketId: packet.id },
    });

    const data = packet.payloadVariant.case === "decoded" ? packet.payloadVariant.value : null;
    if (data?.portnum !== Portnums.PortNum.TEXT_MESSAGE_APP || this.ackMode === "silent") return;

    const errorReason =
      this.ackMode === "ack" ? Mesh.Routing_Error.NONE : Mesh.Routing_Error.MAX_RETRANSMIT;
    const reply: FromRadioVariant = {
      case: "packet",
      value: {
        // A DM is acked by its recipient; a broadcast by our own node (implicit ACK).
        from: packet.to === BROADCAST_NUM ? this.myNodeNum : packet.to,
        to: this.myNodeNum,
        channel: packet.channel,
        id: this.newPacketId(),
        rxTime: this.nowSeconds(),
        payloadVariant: {
          case: "decoded",
          value: {
            portnum: Portnums.PortNum.ROUTING_APP,
            payload: toBinary(
              Mesh.RoutingSchema,
              create(Mesh.RoutingSchema, { variant: { case: "errorReason", value: errorReason } }),
            ),
            requestId: packet.id,
          },
        },
      },
    };
    if (this.ackDelayMs > 0) {
      this.later(this.ackDelayMs, () => {
        if (!socket.destroyed) this.send(socket, reply);
      });
    } else {
      this.send(socket, reply);
    }
  }

  /**
   * Replies to `want_config_id` in the firmware's order (PhoneAPI): my_info, own
   * node_info, metadata, channels, config, module config, other node_infos,
   * then `config_complete_id` echoing the nonce.
   */
  private sendConfig(socket: Socket, nonce: number): void {
    const myNum = this.myNodeNum;
    const own = this.nodeDb.get(myNum);
    this.send(socket, {
      case: "myInfo",
      value: { ...this.scenario.myInfo, rebootCount: this.rebootCount },
    });
    if (own) this.send(socket, { case: "nodeInfo", value: this.nodeInfoNow(own) });
    this.send(socket, { case: "metadata", value: this.scenario.metadata });
    for (const value of this.scenario.channels) this.send(socket, { case: "channel", value });
    for (const value of this.scenario.config) this.send(socket, { case: "config", value });
    for (const value of this.scenario.moduleConfig) {
      this.send(socket, { case: "moduleConfig", value });
    }
    for (const node of this.nodeDb.values()) {
      if (node.info.num !== myNum) {
        this.send(socket, { case: "nodeInfo", value: this.nodeInfoNow(node) });
      }
    }
    if (this.configCompleteMode === "none") return;
    const id = this.configCompleteMode === "echo" ? nonce : (nonce + 1) >>> 0;
    this.send(socket, { case: "configCompleteId", value: id });

    // Environment sensors announce their readings as ordinary telemetry packets.
    for (const node of this.nodeDb.values()) {
      if (!node.environment) continue;
      const telemetry = create(Telemetry.TelemetrySchema, {
        time: this.nowSeconds() - (node.lastHeardAgoS ?? 0),
        variant: { case: "environmentMetrics", value: node.environment },
      });
      this.send(
        socket,
        this.packetVariant(
          this.newPacketId(),
          node.info.num,
          { channel: 0 },
          Portnums.PortNum.TELEMETRY_APP,
          toBinary(Telemetry.TelemetrySchema, telemetry),
          { hopsAway: node.info.hopsAway ?? 0 },
        ),
      );
    }
  }

  private nodeInfoNow(node: ScenarioNode): Mesh.NodeInfo {
    if (node.lastHeardAgoS === null) return node.info;
    const lastHeard = this.nowSeconds() - node.lastHeardAgoS;
    return create(Mesh.NodeInfoSchema, { ...node.info, lastHeard });
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  private newPacketId(): number {
    return this.nextPacketId++ >>> 0;
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private listen(port: number): Promise<void> {
    const server = createServer((socket) => {
      this.accept(socket);
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.host, () => {
        server.off("error", reject);
        this.boundPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private accept(socket: Socket): void {
    this.clients.add(socket);
    socket.setNoDelay(true);
    const framer = new StreamFramer();
    socket.on("data", (chunk) => {
      for (const payload of framer.push(chunk)) {
        let message: ToRadio;
        try {
          message = decodeToRadio(payload);
        } catch {
          this.decodeErrors++;
          continue;
        }
        this.inboundLog.push({ at: this.now(), message });
        this.handle(socket, message);
      }
    });
    socket.on("error", () => {
      // Client resets are expected in tests; `close` cleans up.
    });
    socket.on("close", () => {
      this.clients.delete(socket);
    });
  }

  private async closeServer(): Promise<void> {
    this.dropClients();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
