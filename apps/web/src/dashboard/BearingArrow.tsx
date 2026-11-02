import { cardinal } from "./geo.js";

/** Which way a node lies from mine: an arrow turned to the bearing, and the compass point. */
export function BearingArrow({ degrees }: { degrees: number }) {
  const point = cardinal(degrees);
  return (
    <span data-mt="bearing" title={`${Math.round(degrees)}° ${point} of my node`}>
      <svg
        data-mt="bearing-arrow"
        viewBox="0 0 24 24"
        aria-hidden
        focusable={false}
        style={{ "--mt-bearing": `${Math.round(degrees)}deg` }}
      >
        <path d="M12 3l5 16-5-3-5 3z" />
      </svg>
      <span data-mt="bearing-point">{point}</span>
    </span>
  );
}
