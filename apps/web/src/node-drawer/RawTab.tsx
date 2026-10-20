import { TELEMETRY_KINDS, type NodeDetailDTO } from "@meshterm/shared";
import { formatAbsolute } from "../dashboard/format.js";
import { CopyButton } from "./parts.js";

const KIND_TITLES = {
  device: "Device telemetry",
  environment: "Environment telemetry",
  power: "Power-monitor telemetry",
  air_quality: "Air-quality telemetry",
} as const;

function JsonBlock({ name, title, value }: { name: string; title: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  return (
    <details data-mt="raw-json" data-mt-variant={name}>
      <summary data-mt="raw-json-title">{title}</summary>
      <CopyButton value={json} label={`Copy ${title.toLowerCase()} as JSON`} what={title} />
      <pre data-mt="raw-json-body">{json}</pre>
    </details>
  );
}

/**
 * What MeshTerm has stored about the node, as JSON (CR-001 §5.6). The server keeps
 * decoded fields, not the original protobuf messages, so these are the stored shapes.
 */
export function RawTab({ node }: { node: NodeDetailDTO }) {
  const { latestTelemetry, position, batterySpark: _spark, ...identity } = node;
  return (
    <div data-mt="node-drawer-panel" data-mt-variant="raw">
      <p data-mt="detail-note">
        The latest stored values for this node. Unknown fields from newer firmware show up in the
        telemetry blocks.
      </p>
      <JsonBlock name="node" title="Node" value={identity} />
      {position && <JsonBlock name="position" title="Position" value={position} />}
      {TELEMETRY_KINDS.map((kind) => {
        const report = latestTelemetry[kind];
        return report ? (
          <JsonBlock
            key={kind}
            name={kind}
            title={`${KIND_TITLES[kind]} (${formatAbsolute(report.time)})`}
            value={report}
          />
        ) : null;
      })}
    </div>
  );
}
