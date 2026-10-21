import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setMe } from "../auth/me.js";
import { installCanvasStub, installMatchMediaStub } from "./canvas.js";
import { installLayoutMock } from "./layout.js";
import { TEST_ADMIN } from "./me.js";

// DOM stubs, only when running under jsdom (some files use the node environment).
// jsdom has no layout: these let TanStack Virtual and scrolling code run, with
// fixed sizes from layout.ts.
if (typeof Element !== "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  if (!("ResizeObserver" in globalThis)) {
    Object.assign(globalThis, { ResizeObserver: NoopResizeObserver });
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing in jsdom
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function scrollTo(this: Element, arg?: ScrollToOptions | number) {
      if (typeof arg === "object") this.scrollTop = arg.top ?? this.scrollTop;
    };
  }
  installLayoutMock();
  installCanvasStub();
  installMatchMediaStub();
}

// Components rendered on their own act as a signed-in admin (accounts off).
beforeEach(() => {
  setMe(TEST_ADMIN);
});

afterEach(() => {
  cleanup();
});
