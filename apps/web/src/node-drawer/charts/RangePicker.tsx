import { format } from "date-fns";
import { useState } from "react";
import { PRESET_LABELS, RANGE_PRESETS, type NodeRange } from "./series-data.js";

const toInput = (ms: number) => format(ms, "yyyy-MM-dd'T'HH:mm");

/** 1 h / 24 h / 7 d / 30 d / Custom (two date-time fields), shared by Telemetry and Signal. */
export function RangePicker({
  range,
  onChange,
  now,
}: {
  range: NodeRange;
  onChange: (range: NodeRange) => void;
  now: number;
}) {
  const [custom, setCustom] = useState(range.preset === "custom");
  const [from, setFrom] = useState(() =>
    toInput(range.preset === "custom" ? range.from : now - 24 * 3600_000),
  );
  const [to, setTo] = useState(() => toInput(range.preset === "custom" ? range.to : now));
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const valid = Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs;

  return (
    <div data-mt="range-picker">
      <div data-mt="range-presets" data-mt-variant="segmented" role="group" aria-label="Range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            data-mt="segment"
            data-mt-variant={p}
            data-mt-state={!custom && range.preset === p ? "active" : "inactive"}
            aria-pressed={!custom && range.preset === p}
            onClick={() => {
              setCustom(false);
              onChange({ preset: p });
            }}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        <button
          type="button"
          data-mt="segment"
          data-mt-variant="custom"
          data-mt-state={custom ? "active" : "inactive"}
          aria-pressed={custom}
          onClick={() => {
            setCustom(true);
          }}
        >
          Custom…
        </button>
      </div>
      {custom && (
        <form
          data-mt="range-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onChange({ preset: "custom", from: fromMs, to: toMs });
          }}
        >
          <label>
            From{" "}
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
            />
          </label>
          <label>
            To{" "}
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
            />
          </label>
          <button type="submit" data-mt="button" disabled={!valid}>
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
