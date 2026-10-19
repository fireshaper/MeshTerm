import type { MeshNode } from "@meshterm/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceStrict } from "date-fns";
import { memo, useMemo } from "react";
import { useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { useNow } from "./useNow.js";

/** Most recently heard first; never-heard last; then by node number. */
export function compareNodes(a: MeshNode, b: MeshNode): number {
  if (a.lastHeard !== b.lastHeard) {
    if (a.lastHeard === null) return 1;
    if (b.lastHeard === null) return -1;
    return b.lastHeard - a.lastHeard;
  }
  return a.num - b.num;
}

export function NodeTable() {
  const connectionId = useLiveStore((s) => s.connectionId);
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const { data: nodes = [], isPending } = useNodes(connectionId);
  const now = useNow();
  const sorted = useMemo(() => [...nodes].sort(compareNodes), [nodes]);

  if (connectionId === null || isPending) return <p data-mt="node-list-waiting">Loading nodes…</p>;
  return (
    <div data-mt="node-table-wrap">
      <table data-mt="node-table">
        <caption data-mt="node-count">
          {sorted.length} {sorted.length === 1 ? "node" : "nodes"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Short</th>
            <th scope="col">ID</th>
            <th scope="col">Hardware</th>
            <th scope="col">Last heard</th>
            <th scope="col">SNR</th>
            <th scope="col">Hops</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((node) => (
            <NodeRow key={node.num} node={node} isSelf={node.num === myNodeNum} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface NodeRowProps {
  node: MeshNode;
  isSelf: boolean;
  now: number;
}

const NodeRow = memo(function NodeRow({ node, isSelf, now }: NodeRowProps) {
  const navigate = useNavigate();
  const name = node.longName || node.id;
  const openDm = () => {
    if (!isSelf) void navigate({ to: "/dm/$nodeNum", params: { nodeNum: String(node.num) } });
  };
  return (
    <tr
      data-mt="node-row"
      data-mt-state={isSelf ? "self" : "other"}
      data-node-num={node.num}
      onClick={openDm}
    >
      <th scope="row" data-mt="node-name">
        {isSelf ? (
          <>
            {name} <span data-mt="node-self-badge">(you)</span>
          </>
        ) : (
          <Link
            to="/dm/$nodeNum"
            params={{ nodeNum: String(node.num) }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {name}
          </Link>
        )}
      </th>
      <td data-mt="node-short-name">{node.shortName}</td>
      <td data-mt="node-id">{node.id}</td>
      <td data-mt="node-hardware">{node.hwModel ?? "—"}</td>
      <td data-mt="node-last-heard">
        {node.lastHeard === null
          ? "never"
          : formatDistanceStrict(node.lastHeard, Math.max(now, node.lastHeard), {
              addSuffix: true,
            })}
      </td>
      {/* Firmware reports 0 for the local node; signal to yourself means nothing. */}
      <td data-mt="node-snr">{isSelf || node.snr === null ? "—" : `${node.snr} dB`}</td>
      <td data-mt="node-hops">{node.hopsAway === null ? "—" : node.hopsAway}</td>
    </tr>
  );
});
