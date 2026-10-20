import { AlertTriangle, BatteryWarning, Gauge, MoonStar } from "lucide-react";
import type { AttentionItem, AttentionKind } from "./insights.js";

const ICONS: Record<AttentionKind, typeof AlertTriangle> = {
  battery: BatteryWarning,
  "quiet-favorite": MoonStar,
  "channel-util": Gauge,
  "air-util-tx": Gauge,
};

/** Nodes or metrics worth a look, most severe first. */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul data-mt="attention-list">
      {items.map(({ card, kind, severity, text }) => {
        const Icon = ICONS[kind];
        return (
          <li
            key={`${card.num}-${kind}`}
            data-mt="attention-item"
            data-mt-state={severity}
            data-mt-variant={kind}
          >
            <Icon data-mt="icon" aria-hidden focusable={false} />
            <span data-mt="attention-node">
              {card.isSelf ? "My node" : card.longName || card.shortName || card.userId}
            </span>
            <span data-mt="attention-text">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
