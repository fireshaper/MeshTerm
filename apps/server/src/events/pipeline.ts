import { randomUUID } from "node:crypto";
import type { FromRadio } from "@meshterm/protocol";
import type { NodeConnection } from "../connection/node-connection.js";
import type { StateChange } from "../connection/state-machine.js";
import { silentLogger, type Logger } from "../logger.js";
import {
  decodeFromRadio,
  nodeHeard,
  packetPort,
  packetSignal,
  type DecodeContext,
} from "./decoder.js";
import type { Hub, HubEvents, RadioEvents } from "./events.js";

export interface PipelineOptions {
  logger?: Logger;
  now?: () => number;
  newId?: () => string;
}

/**
 * NodeConnection → decoder → hub. State changes become `connection.state`; every
 * `FromRadio` becomes a `radio.node` "heard" update (for packets) plus whatever the
 * decoder makes of it. Returns a function that unwires.
 */
export function wireConnection(
  conn: NodeConnection,
  hub: Hub,
  options: PipelineOptions = {},
): () => void {
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const connectionId = conn.connection.id;

  const onState = ({ previous, state, reason }: StateChange) => {
    hub.publish("connection.state", { connectionId, state, previous, reason });
  };
  const onFromRadio = (message: FromRadio) => {
    const ctx: DecodeContext = { connectionId, now: now(), newId };
    if (message.payloadVariant.case === "packet") {
      const packet = message.payloadVariant.value;
      hub.publish("radio.packet", {
        connectionId,
        at: ctx.now,
        from: packet.from,
        port: packetPort(packet),
        ...packetSignal(packet, ctx.now),
      });
    }
    const heard = nodeHeard(message, ctx);
    if (heard) publish(hub, heard);
    const result = decodeFromRadio(message, ctx);
    for (const event of result.events) publish(hub, event);
    if (result.ignored)
      logger.debug({ connectionId, ignored: result.ignored }, "FromRadio ignored");
  };

  conn.on("state", onState);
  conn.on("fromRadio", onFromRadio);
  return () => {
    conn.off("state", onState);
    conn.off("fromRadio", onFromRadio);
  };
}

function publish<K extends keyof RadioEvents>(
  hub: Hub,
  event: { type: K; payload: HubEvents[K] },
): void {
  hub.publish(event.type, event.payload);
}
