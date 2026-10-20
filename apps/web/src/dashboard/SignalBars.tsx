import { SIGNAL_BARS, signalQuality } from "./insights.js";

const BAR_HEIGHTS = [4, 7, 10, 13];

/** Four bars from the SNR of the last packet heard directly. */
export function SignalBars({ snr }: { snr: number | null }) {
  const quality = signalQuality(snr);
  const lit = SIGNAL_BARS[quality];
  return (
    <svg
      data-mt="signal-bars"
      data-mt-state={quality}
      viewBox="0 0 16 14"
      role="img"
      aria-label={`Signal ${quality}`}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={h}
          x={i * 4}
          y={14 - h}
          width="3"
          height={h}
          rx="0.5"
          data-mt-state={i < lit ? "on" : "off"}
        />
      ))}
    </svg>
  );
}
