import { nodeIdFromNum } from "@meshterm/shared";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ConversationView } from "../components/ConversationView.js";
import { useNodes } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";

/** `nodeNum` is the decimal node number, as in `/dm/195939070`. */
export function parseNodeNum(param: string): number | null {
  if (!/^\d{1,10}$/.test(param)) return null;
  const n = Number(param);
  return n > 0 && n < 0xffff_ffff ? n : null;
}

export function DmPage() {
  const { nodeNum } = useParams({ from: "/dm/$nodeNum" });
  const num = parseNodeNum(nodeNum);
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data: nodes } = useNodes(connectionId);
  const peer = nodes?.find((n) => n.num === num);
  const conversation = useMemo(() => ({ peer: num ?? 0 }), [num]);

  if (num === null) {
    return (
      <section data-mt="dm-view" data-mt-state="invalid">
        <h1 data-mt="page-title">Unknown node</h1>
      </section>
    );
  }
  const id = nodeIdFromNum(num);
  return (
    <section data-mt="dm-view" data-mt-state="ready">
      <h1 data-mt="page-title">Direct messages with {peer?.longName || id}</h1>
      {peer?.longName && <p data-mt="dm-peer-id">{id}</p>}
      <ConversationView conversation={conversation} />
    </section>
  );
}
