import { TELEMETRY_KINDS, type NodeDetailDTO } from "@meshterm/shared";
import { formatAbsolute } from "../dashboard/format.js";
import type { ReactNode } from "react";
import { CopyButton } from "./parts.js";

const KIND_TITLES = {
  device: "Device telemetry",
  environment: "Environment telemetry",
  power: "Power-monitor telemetry",
  air_quality: "Air-quality telemetry",
} as const;

/** JSON keys, strings, numbers, booleans and null, in the order they appear. */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)|(null)/g;

/**
 * Pretty-printed JSON as spans (CR-005 §6.6): `raw-key`, and `raw-value` with the
 * value's type as variant. The text is unchanged, so selecting and copying still work.
 */
export function highlightJson(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of json.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push(json.slice(last, at));
    const [whole, str, colon, num, bool, nul] = m;
    if (str !== undefined && colon !== undefined) {
      out.push(
        <span key={at} data-mt="raw-key">
          {str}
        </span>,
        colon,
      );
    } else {
      const variant =
        str !== undefined
          ? "string"
          : num !== undefined
            ? "number"
            : bool !== undefined
              ? "boolean"
              : nul !== undefined
                ? "null"
                : "string";
      out.push(
        <span key={at} data-mt="raw-value" data-mt-variant={variant}>
          {whole}
        </span>,
      );
    }
    last = at + whole.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

function JsonBlock({ name, title, value }: { name: string; title: string; value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  return (
    <details data-mt="raw-json" data-mt-variant={name}>
      <summary data-mt="raw-json-title">{title}</summary>
      <CopyButton value={json} label={`Copy ${title.toLowerCase()} as JSON`} what={title} />
      <pre data-mt="raw-json-body">{highlightJson(json)}</pre>
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
