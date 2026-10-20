import { nodeIdFromNum } from "@meshterm/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useNow } from "../components/useNow.js";
import { formatAgo } from "../dashboard/format.js";
import { STATUS_LABELS } from "../dashboard/insights.js";
import { nodeStatus } from "../dashboard/view.js";
import { useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";
import { pickerNodes, pickerWarnings } from "./conversation-list.js";
import { useThresholds } from "./useNodeMap.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

function hopsLabel(hops: number | null): string | null {
  if (hops === null) return null;
  return hops === 0 ? "direct" : hops === 1 ? "1 hop" : `${hops} hops`;
}

interface NodePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Known nodes to start a DM with: searchable, favorites first, with delivery warnings. */
export function NodePicker({ open, onOpenChange }: NodePickerProps) {
  const connectionId = useLiveStore((s) => s.connectionId);
  const myNodeNum = useLiveStore((s) => s.myNodeNum);
  const { data: nodes = [] } = useNodes(connectionId);
  const thresholds = useThresholds(connectionId);
  const navigate = useNavigate();
  const now = useNow();
  const [query, setQuery] = useState("");
  const list = pickerNodes(nodes, myNodeNum, query);

  function pick(num: number) {
    onOpenChange(false);
    setQuery("");
    void navigate({ to: "/messages/dm/$nodeId", params: { nodeId: nodeIdFromNum(num) } });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-mt="drawer-overlay" />
        <Dialog.Content data-mt="node-picker" aria-describedby={undefined}>
          <header data-mt="node-picker-header">
            <Dialog.Title data-mt="node-picker-title">New direct message</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" data-mt="icon-button" aria-label="Close">
                <X data-mt="icon" {...ICON} />
              </button>
            </Dialog.Close>
          </header>
          <input
            data-mt="node-picker-search"
            type="search"
            placeholder="Search nodes by name or ID…"
            aria-label="Search nodes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          {list.length === 0 ? (
            <p data-mt="node-picker-empty">
              {query ? "No matching nodes." : "No nodes known yet."}
            </p>
          ) : (
            <ul data-mt="node-picker-list" aria-label="Nodes">
              {list.map((node) => {
                const status = nodeStatus(node.lastHeard, now, thresholds);
                const hops = hopsLabel(node.hopsAway);
                const warnings = pickerWarnings(node, now);
                return (
                  <li key={node.num}>
                    <button
                      type="button"
                      data-mt="node-picker-item"
                      data-node-num={node.num}
                      data-mt-state={node.isFavorite ? "favorite" : "normal"}
                      onClick={() => {
                        pick(node.num);
                      }}
                    >
                      <span
                        data-mt="status-dot"
                        data-mt-state={status}
                        title={STATUS_LABELS[status]}
                      />
                      <span data-mt="node-picker-names">
                        <span data-mt="node-picker-short">
                          {node.isFavorite && <span aria-label="Favorite">★ </span>}
                          {node.shortName || node.id.slice(-4)}
                        </span>
                        <span data-mt="node-picker-long">{node.longName || node.id}</span>
                      </span>
                      <span data-mt="node-picker-meta">
                        {[
                          hops,
                          node.lastHeard === null
                            ? "never heard"
                            : formatAgo(node.lastHeard, Math.max(now, node.lastHeard)),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {warnings.map((w) => (
                        <span key={w.kind} data-mt="node-picker-warning" data-mt-variant={w.kind}>
                          <TriangleAlert data-mt="icon" {...ICON} />
                          {w.text}
                        </span>
                      ))}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
