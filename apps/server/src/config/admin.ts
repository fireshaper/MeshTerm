import {
  Admin,
  create,
  fromBinary,
  Mesh,
  Portnums,
  toBinary,
  type FromRadio,
  type MessageInitShape,
} from "@meshterm/protocol";
import type { Clock, Random } from "../clock.js";
import type { NodeConnection } from "../connection/node-connection.js";
import { silentLogger, type Logger } from "../logger.js";

export type AdminVariant = NonNullable<
  MessageInitShape<typeof Admin.AdminMessageSchema>["payloadVariant"]
>;
type ResponseCase = NonNullable<Admin.AdminMessage["payloadVariant"]["case"]>;

/** An admin request failed: `code` is a `Routing.Error` name, `timeout` or `disconnected`. */
export class AdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/** Errors after which a fresh session passkey may help (CR-002 §4). */
const PASSKEY_ERRORS = new Set(["ADMIN_BAD_SESSION_KEY", "NOT_AUTHORIZED"]);

interface Pending {
  /** For gets: the response variant we wait for. Sets wait for the routing reply. */
  expect: ResponseCase | null;
  resolve: (value: Admin.AdminMessage | null) => void;
  reject: (err: AdminError) => void;
  cancel: () => void;
}

export interface AdminClientOptions {
  clock: Clock;
  random: Random;
  /** How long a get may take. */
  getTimeoutMs?: number;
  /** How long to wait for a set's routing reply; none means "sent, unconfirmed". */
  ackWaitMs?: number;
  logger?: Logger;
}

/**
 * `AdminMessage`s to our own node over the API link (`ADMIN_APP`, to = our node
 * number; nothing goes out over LoRa). Gets wait for their response; sets wait for
 * the routing reply. The firmware's session passkey comes with every get response
 * and goes with every message; a set refused for its passkey is retried once after a
 * fresh get. Only an explicit admin action calls this (never the handshake).
 */
export class AdminClient {
  private passkey: Uint8Array = new Uint8Array();
  private readonly pending = new Map<number, Pending>();
  private readonly getTimeoutMs: number;
  private readonly ackWaitMs: number;
  private readonly logger: Logger;

  constructor(
    private readonly conn: NodeConnection,
    private readonly options: AdminClientOptions,
  ) {
    this.getTimeoutMs = options.getTimeoutMs ?? 8_000;
    this.ackWaitMs = options.ackWaitMs ?? 4_000;
    this.logger = options.logger ?? silentLogger;
    conn.on("fromRadio", (m) => {
      this.onFromRadio(m);
    });
    conn.on("state", ({ state }) => {
      if (state === "connected") return;
      // A dropped link ends every request; a reboot also ends the passkey.
      this.passkey = new Uint8Array();
      for (const [id, p] of this.pending) {
        p.cancel();
        p.reject(new AdminError("disconnected", `the link to the node dropped (${state})`));
        this.pending.delete(id);
      }
    });
  }

  get hasPasskey(): boolean {
    return this.passkey.length > 0;
  }

  /** A get request; resolves with the response (which also refreshes the passkey). */
  async get(variant: AdminVariant, expect: ResponseCase): Promise<Admin.AdminMessage> {
    const response = await this.transmit(variant, expect);
    if (!response) throw new AdminError("timeout", `no ${expect} from the node`);
    return response;
  }

  /** Makes sure we hold a session passkey (a get of the owner, which every firmware answers). */
  async refreshPasskey(): Promise<Admin.AdminMessage> {
    return this.get({ case: "getOwnerRequest", value: true }, "getOwnerResponse");
  }

  /** A set (or begin/commit/maintenance); retried once with a fresh passkey if refused for it. */
  async set(variant: AdminVariant): Promise<void> {
    if (!this.hasPasskey) await this.refreshPasskey();
    try {
      await this.transmit(variant, null);
    } catch (err) {
      if (!(err instanceof AdminError) || !PASSKEY_ERRORS.has(err.code)) throw err;
      this.logger.info({ code: err.code }, "admin message refused for its passkey; retrying once");
      await this.refreshPasskey();
      await this.transmit(variant, null);
    }
  }

  private transmit(
    variant: AdminVariant,
    expect: ResponseCase | null,
  ): Promise<Admin.AdminMessage | null> {
    const myNodeNum = this.conn.model.myNodeNum;
    if (myNodeNum === null) {
      return Promise.reject(new AdminError("disconnected", "no handshake with the node yet"));
    }
    const id = Math.floor(this.options.random() * 0xffff_fffe) + 1;
    const message = create(Admin.AdminMessageSchema, {
      payloadVariant: variant,
      sessionPasskey: this.passkey,
    });
    return new Promise((resolve, reject) => {
      const cancel = this.options.clock.setTimer(
        expect ? this.getTimeoutMs : this.ackWaitMs,
        () => {
          this.pending.delete(id);
          // A get must answer; a set without a reply is "sent, unconfirmed" (verify catches it).
          if (expect)
            reject(new AdminError("timeout", `no ${expect} within ${this.getTimeoutMs} ms`));
          else resolve(null);
        },
      );
      this.pending.set(id, { expect, resolve, reject, cancel });
      try {
        this.conn.send({
          payloadVariant: {
            case: "packet",
            value: {
              id,
              to: myNodeNum,
              wantAck: true,
              payloadVariant: {
                case: "decoded",
                value: {
                  portnum: Portnums.PortNum.ADMIN_APP,
                  payload: toBinary(Admin.AdminMessageSchema, message),
                  wantResponse: expect !== null,
                },
              },
            },
          },
        });
      } catch (err) {
        cancel();
        this.pending.delete(id);
        reject(new AdminError("disconnected", err instanceof Error ? err.message : String(err)));
      }
    });
  }

  private onFromRadio(message: FromRadio): void {
    if (message.payloadVariant.case !== "packet") return;
    const packet = message.payloadVariant.value;
    if (packet.payloadVariant.case !== "decoded") return;
    const data = packet.payloadVariant.value;
    const p = this.pending.get(data.requestId);
    if (!data.requestId || !p) return;

    if (data.portnum === Portnums.PortNum.ROUTING_APP) {
      const routing = fromBinary(Mesh.RoutingSchema, data.payload);
      const reason = routing.variant.case === "errorReason" ? routing.variant.value : 0;
      if (reason !== Mesh.Routing_Error.NONE) {
        p.cancel();
        this.pending.delete(data.requestId);
        const name: unknown = (Mesh.Routing_Error as unknown as Record<number, unknown>)[reason];
        const code = typeof name === "string" ? name : String(reason);
        p.reject(new AdminError(code, `the node refused the admin message: ${code}`));
      } else if (p.expect === null) {
        p.cancel();
        this.pending.delete(data.requestId);
        p.resolve(null);
      }
      return;
    }
    if (data.portnum !== Portnums.PortNum.ADMIN_APP) return;
    const response = fromBinary(Admin.AdminMessageSchema, data.payload);
    if (response.sessionPasskey.length > 0) this.passkey = response.sessionPasskey;
    if (p.expect && response.payloadVariant.case === p.expect) {
      p.cancel();
      this.pending.delete(data.requestId);
      p.resolve(response);
    }
  }
}
