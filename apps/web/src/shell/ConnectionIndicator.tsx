import { useConnections, useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { StatusPill } from "./StatusPill.js";

/** My node's name and how MeshTerm reaches it, from data the app already has. */
export function useDeviceInfo() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const { data: connections } = useConnections();
  const { data: nodes } = useNodes(connectionId);
  const connection = connections?.find((c) => c.id === connectionId) ?? null;
  const me = nodes?.find((n) => n.num === myNodeNum) ?? null;
  return {
    name: me ? me.longName || me.shortName || me.id : null,
    shortName: me?.shortName ?? null,
    /** e.g. "TCP 192.168.1.186:4403". */
    link: connection
      ? `${connection.transport.toUpperCase()} ${connection.host}:${connection.port}`
      : null,
  };
}

/**
 * Connection status for the header, visible on every page: the status pill, plus my
 * node's name and the link (hidden on narrow screens by CSS).
 */
export function ConnectionIndicator() {
  const { name, link } = useDeviceInfo();
  return (
    <div data-mt="connection-indicator">
      {(name !== null || link !== null) && (
        <span data-mt="connection-device">
          {name !== null && <span data-mt="connection-device-name">{name}</span>}
          {link !== null && <span data-mt="connection-link">{link}</span>}
        </span>
      )}
      <StatusPill />
    </div>
  );
}
