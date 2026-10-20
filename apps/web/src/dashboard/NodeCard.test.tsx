import { DEFAULT_DASHBOARD_THRESHOLDS, type NodeCard as NodeCardData } from "@meshterm/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetUiStore, useUiStore } from "../data/ui-store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { scenarioDashboard } from "../test/scenario.js";
import { NodeCard, UPDATE_FLASH_MS, type NodeCardProps } from "./NodeCard.js";

const NOW = 1_800_000_000_000;
const cards = scenarioDashboard("dashboard", NOW).nodes;
const byShort = (short: string) => cards.find((c) => c.shortName === short) as NodeCardData;
const self = byShort("MTB");

afterEach(() => {
  vi.useRealTimers();
});

/** Renders one card inside a router (the card navigates to DMs). */
function renderCard(card: NodeCardData, props: Partial<NodeCardProps> = {}) {
  const onFavorite = vi.fn();
  let setCard: (c: NodeCardData) => void = () => undefined;
  const Card = () => {
    const [current, set] = useState(card);
    setCard = set;
    return (
      <NodeCard
        card={current}
        origin={self.position}
        now={NOW}
        thresholds={DEFAULT_DASHBOARD_THRESHOLDS}
        density="comfy"
        onFavorite={onFavorite}
        {...props}
      />
    );
  };
  const rootRoute = createRootRoute({ component: Card });
  const dmRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/messages/dm/$nodeId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dmRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const utils = render(<RouterProvider router={router} />);
  const article = () => screen.getByRole("article");
  const rerender = (next: NodeCardData) => {
    act(() => {
      setCard(next);
    });
  };
  return { ...utils, router, onFavorite, article, rerender };
}

const metric = (name: string) =>
  document.querySelector<HTMLElement>(`[data-mt="metric-row"][data-mt-variant="${name}"] dd`);

describe("NodeCard", () => {
  it("my node: self variant, map with self marker, no signal/hops/message", async () => {
    const { article } = renderCard(self);
    await screen.findByRole("article");
    expectDataMt(article(), "node-card", { variant: "self CLIENT", state: "online" });
    expectDataMt(byDataMt("status-dot"), "status-dot", { state: "online" });
    expectDataMt(byDataMt("role-badge"), "role-badge", { variant: "CLIENT" });
    expect(byDataMt("role-badge")).toHaveTextContent("Client");
    expect(byDataMt("node-hardware")).toHaveTextContent("Heltec V3");
    expect(byDataMt("node-id")).toHaveTextContent("!a1b2c3d4");
    expectDataMt(byDataMt("mini-map"), "mini-map", { state: "ready", variant: "self" });
    expect(byDataMt("node-place")).toHaveTextContent("52 m alt");
    expect(metric("signal")).toBeNull();
    expect(metric("hops")).toBeNull();
    expect(screen.queryByRole("button", { name: /Message/ })).toBeNull();
    expect(metric("power")).toHaveTextContent("87% · 4.05 V");
    expectDataMt(byDataMt("battery-meter"), "battery-meter", { state: "ok" });
    expect(metric("channel-util")).toHaveTextContent("12.5%");
    expect(metric("air-util-tx")).toHaveTextContent("3.2%");
    expect(metric("uptime")).toHaveTextContent("3d 3h");
    expect(metric("environment")).toBeNull();
  });

  it("powered favorite heard directly: plug, signal and Direct", async () => {
    const { article } = renderCard(byShort("RDG"));
    await screen.findByRole("article");
    expectDataMt(article(), "node-card", { variant: "favorite ROUTER", state: "online" });
    expectDataMt(byDataMt("battery-meter"), "battery-meter", { state: "powered" });
    expect(metric("power")).toHaveTextContent("Powered · 5.10 V");
    expect(metric("signal")).toHaveTextContent("SNR 7.25 dB");
    expect(metric("hops")).toHaveTextContent("Direct");
    expectDataMt(byDataMt("favorite-toggle"), "favorite-toggle", { state: "on" });
    // Distance and bearing from my node.
    expect(byDataMt("node-place")?.textContent).toMatch(/^\d+(\.\d)? km NE · 312 m alt$/);
  });

  it("multi-hop node with an environment sensor: 'via N hops' and an Env row", async () => {
    renderCard(byShort("GAR"));
    await screen.findByRole("article");
    expect(metric("signal")).toHaveTextContent("via 2 hops");
    expect(metric("hops")).toHaveTextContent("2 hops");
    expect(metric("environment")).toHaveTextContent("22.4 °C · 61% · 1013 hPa");
  });

  it("reduced-precision node: a precision circle on its map", async () => {
    renderCard(byShort("TRL"));
    await screen.findByRole("article");
    expectDataMt(byDataMt("mini-map-precision"), "mini-map-precision");
    expect(byDataMt("mini-map-tiles")?.querySelectorAll("img")).toHaveLength(6);
  });

  it("no-position, stale and offline nodes", async () => {
    const kayak = renderCard(byShort("KYK"));
    await screen.findByRole("article");
    expectDataMt(kayak.article(), "node-card", { state: "offline" });
    expectDataMt(byDataMt("mini-map"), "mini-map", { state: "empty" });
    expect(byDataMt("mini-map")).toHaveTextContent("No position shared");
    expect(byDataMt("node-place")).toBeNull();
    expectDataMt(byDataMt("battery-meter"), "battery-meter", { state: "critical" });
    expect(metric("last-seen")).toHaveTextContent("3 d ago");
    kayak.unmount();

    const hill = renderCard(byShort("HIL"));
    await screen.findByRole("article");
    expectDataMt(hill.article(), "node-card", { state: "stale" });
    expectDataMt(byDataMt("battery-meter"), "battery-meter", { state: "low" });
    hill.unmount();

    renderCard(byShort("BIK"));
    await screen.findByRole("article");
    expect(metric("last-seen")).toHaveTextContent("Never");
    expect(metric("power")).toHaveTextContent("—");
    expectDataMt(byDataMt("battery-meter"), "battery-meter", { state: "unknown" });
  });

  it("compact density hides the map and sparkline", async () => {
    const card = {
      ...byShort("RDG"),
      batterySpark: [
        [NOW - 3600_000, 90],
        [NOW, 85],
      ] as [number, number][],
    };
    const comfy = renderCard(card);
    await screen.findByRole("article");
    expectDataMt(byDataMt("sparkline"), "sparkline");
    comfy.unmount();
    renderCard(card, { density: "compact" });
    await screen.findByRole("article");
    expect(byDataMt("mini-map")).toBeNull();
    expect(byDataMt("sparkline")).toBeNull();
  });

  it("the sparkline needs at least two points", async () => {
    renderCard({ ...byShort("RDG"), batterySpark: [[NOW, 85]] });
    await screen.findByRole("article");
    expect(byDataMt("sparkline")).toBeNull();
  });

  it("flashes 'updated' for 1.5 s when new data arrives", async () => {
    const ridge = byShort("RDG");
    const { article, rerender } = renderCard(ridge);
    await screen.findByRole("article");
    vi.useFakeTimers();
    rerender({ ...ridge, longName: "Renamed" }); // not new data
    expect(article()).toHaveAttribute("data-mt-state", "online");
    rerender({ ...ridge, lastHeard: NOW });
    expect(article()).toHaveAttribute("data-mt-state", "updated");
    act(() => {
      vi.advanceTimersByTime(UPDATE_FLASH_MS);
    });
    expect(article()).toHaveAttribute("data-mt-state", "online");
  });

  it("keyboard: Enter opens the details drawer, f toggles favorite", async () => {
    resetUiStore();
    const { article, onFavorite } = renderCard(byShort("GAR"));
    await screen.findByRole("article");
    fireEvent.keyDown(article(), { key: "f" });
    expect(onFavorite).toHaveBeenCalledWith(1584361601, true);
    fireEvent.keyDown(article(), { key: "Enter" });
    expect(useUiStore.getState().selectedNode).toBe(1584361601);
  });

  it("the Details button opens the drawer, also on my own card", async () => {
    resetUiStore();
    renderCard(self);
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(useUiStore.getState().selectedNode).toBe(self.num);
  });

  it("keys typed on the card's buttons don't trigger card shortcuts", async () => {
    const { onFavorite } = renderCard(byShort("GAR"));
    const article = await screen.findByRole("article");
    fireEvent.keyDown(within(article).getByRole("button", { name: /Message/ }), { key: "f" });
    expect(onFavorite).not.toHaveBeenCalled();
  });

  it("the Message button opens the DM", async () => {
    const { router } = renderCard(byShort("GAR"));
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: /Message/ }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/messages/dm/!5e6f7081");
    });
  });

  it("copies the node ID", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderCard(byShort("GAR"));
    await screen.findByRole("article");
    fireEvent.click(screen.getByRole("button", { name: "!5e6f7081" }));
    expect(writeText).toHaveBeenCalledWith("!5e6f7081");
    await vi.waitFor(() => {
      expectDataMt(byDataMt("node-id"), "node-id", { state: "copied" });
    });
  });
});
