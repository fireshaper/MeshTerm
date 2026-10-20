/**
 * jsdom has no canvas: a 2D context that accepts every call and property, so canvas
 * renderers (uPlot) run in component tests. Nothing is drawn.
 */
export function installCanvasStub(): void {
  const context = (canvas: HTMLCanvasElement) => {
    const values: Record<string | symbol, unknown> = { canvas };
    return new Proxy(values, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "measureText") return (text: string) => ({ width: text.length * 6 });
        if (prop === "getLineDash") return () => [];
        if (prop === "createLinearGradient" || prop === "createPattern")
          return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
  };
  if (!("Path2D" in globalThis)) {
    // Paths are only built, never drawn: every method is a no-op.
    function Path2D() {
      return new Proxy({}, { get: () => () => undefined });
    }
    Object.assign(globalThis, { Path2D });
  }
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement) {
      return context(this);
    },
  });
}

/** `matchMedia` that matches nothing (jsdom has none). */
export function installMatchMediaStub(): void {
  if (typeof (window as { matchMedia?: unknown }).matchMedia === "function") return;
  const matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.assign(window, { matchMedia });
}
