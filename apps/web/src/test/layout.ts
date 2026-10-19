// jsdom has no layout engine, so every size is 0. These fixed sizes for the
// virtualized message list's viewport and rows let TanStack Virtual compute a
// realistic window in tests. Other elements keep jsdom's zeros.

export const VIEWPORT = { width: 400, height: 600 };
export const ROW_HEIGHT = 72;

function sizeOf(el: Element): { width: number; height: number } | null {
  switch (el.getAttribute("data-mt")) {
    case "message-list":
      return VIEWPORT;
    case "message-row":
      return { width: VIEWPORT.width, height: ROW_HEIGHT };
    default:
      return null;
  }
}

export function installLayoutMock(): void {
  // Saved to call with .call(this) below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    const size = sizeOf(this);
    if (!size) return originalRect.call(this);
    return new DOMRect(0, 0, size.width, size.height);
  };
  for (const [prop, key] of [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
    ["clientWidth", "width"],
    ["clientHeight", "height"],
  ] as const) {
    const original =
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop) ??
      Object.getOwnPropertyDescriptor(Element.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        const size = sizeOf(this);
        if (size) return size[key];
        return (original?.get?.call(this) as number | undefined) ?? 0;
      },
    });
  }
}
