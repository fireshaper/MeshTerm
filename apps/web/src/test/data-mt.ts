import { expect } from "vitest";

export interface DataMtExpectation {
  state?: string;
  variant?: string;
}

/**
 * Asserts a rendered component's theming hooks: `data-mt="<component>"`, plus
 * `data-mt-state` / `data-mt-variant` when given. These attributes are a public
 * API for themes, so every component test checks them.
 */
export function expectDataMt(
  element: Element | null,
  component: string,
  expected: DataMtExpectation = {},
): void {
  expect(element, `no element for data-mt="${component}"`).not.toBeNull();
  expect(element?.getAttribute("data-mt")).toBe(component);
  if (expected.state !== undefined) {
    expect(element?.getAttribute("data-mt-state")).toBe(expected.state);
  }
  if (expected.variant !== undefined) {
    expect(element?.getAttribute("data-mt-variant")).toBe(expected.variant);
  }
}

/** The element with `data-mt="<component>"` inside `container` (default: document). */
export function byDataMt(component: string, container: ParentNode = document): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-mt="${CSS.escape(component)}"]`);
}
