import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetLiveStore, useLiveStore } from "../data/store.js";
import { byDataMt, expectDataMt } from "../test/data-mt.js";
import { PILL_LABELS, StatusPill, type PillState } from "./StatusPill.js";

beforeEach(() => {
  resetLiveStore();
  useLiveStore.getState().setSocketStatus("open");
});

describe("<StatusPill />", () => {
  it("shows unknown before the first state arrives", () => {
    render(<StatusPill />);
    expectDataMt(byDataMt("status-pill"), "status-pill", { state: "unknown" });
    expect(screen.getByRole("status")).toHaveTextContent("Unknown");
  });

  it.each(
    (["connected", "configuring", "connecting", "reconnecting", "disconnected"] as const).map(
      (s): [PillState, string] => [s, PILL_LABELS[s]],
    ),
  )("renders %s with its data-mt-state and label", (state, label) => {
    render(<StatusPill />);
    act(() => {
      useLiveStore.getState().setNodeState(state as Exclude<PillState, "unknown">);
    });
    expectDataMt(byDataMt("status-pill"), "status-pill", { state });
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByRole("status")).toHaveAccessibleName(`Node: ${label}`);
  });

  it("adds a separate indicator while the server socket is down", () => {
    render(<StatusPill />);
    act(() => {
      useLiveStore.getState().setNodeState("connected");
      useLiveStore.getState().setSocketStatus("closed");
    });
    expectDataMt(byDataMt("status-pill"), "status-pill", { state: "connected" });
    expectDataMt(byDataMt("socket-indicator"), "socket-indicator", { state: "closed" });
    expect(screen.getByRole("alert")).toHaveTextContent("Server offline");

    act(() => {
      useLiveStore.getState().setSocketStatus("open");
    });
    expect(byDataMt("socket-indicator")).toBeNull();
  });
});
