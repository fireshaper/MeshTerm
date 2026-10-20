import { Info } from "lucide-react";
import { useId } from "react";

/**
 * A small "i" that explains a metric on hover or keyboard focus. The text is also the
 * button's description, so screen readers get it without hovering.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <span data-mt="info-tip">
      <button
        type="button"
        data-mt="info-tip-button"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        <Info data-mt="icon" aria-hidden focusable={false} />
      </button>
      <span data-mt="info-tip-text" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
