import { useEffect, useRef } from "react";

/**
 * Calls `onChange` when the theme stylesheet or the color scheme attribute changes, so
 * canvas renderers (map, charts) can re-read their `--mt-*` tokens.
 */
export function useThemeChange(onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const link = document.querySelector('[data-mt="theme-link"]');
    const observer = new MutationObserver(() => {
      latest.current();
    });
    if (link) observer.observe(link, { attributes: true, attributeFilter: ["href"] });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mt-theme", "data-mt-scheme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
}
