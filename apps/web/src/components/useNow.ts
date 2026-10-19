import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** How often relative times ("3 min ago") re-render. */
export const NOW_INTERVAL_MS = 30_000;

const NowContext = createContext<number | null>(null);

/** Ticks once for the whole app, so 300 cards share one timer instead of 300. */
export function NowProvider({ children }: { children: ReactNode }) {
  const now = useTicker(NOW_INTERVAL_MS);
  return createElement(NowContext.Provider, { value: now }, children);
}

function useTicker(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

/**
 * Current time in epoch ms for relative timestamps. Without an argument it is the
 * shared 30-second clock from `NowProvider` (or a local one outside it); pass a
 * shorter interval for something that must tick faster, like "last packet 4 s ago".
 */
export function useNow(intervalMs?: number): number {
  const shared = useContext(NowContext);
  const useShared = intervalMs === undefined && shared !== null;
  const local = useTicker(useShared ? null : (intervalMs ?? NOW_INTERVAL_MS));
  return useShared ? shared : local;
}
