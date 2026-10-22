import { useEffect, useRef } from "react";
import { THEME_APPLIED_EVENT } from "../theme/theme.js";

/**
 * Calls `onChange` after a theme or mode is applied (`theme:applied`, CR-004 §4.5), so
 * canvas renderers (map, charts, the favicon badge) can re-read their `--mt-*` tokens.
 */
export function useThemeChange(onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const listener = () => {
      latest.current();
    };
    window.addEventListener(THEME_APPLIED_EVENT, listener);
    return () => {
      window.removeEventListener(THEME_APPLIED_EVENT, listener);
    };
  }, []);
}
