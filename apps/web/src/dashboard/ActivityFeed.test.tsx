import type { ActivityEvent, ActivityPage, TrafficDTO } from "@meshterm/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ACTIVITY_CACHE_LIMIT, applyServerMessage } from "../data/apply.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";
import { expectDataMt } from "../test/data-mt.js";
import { renderApp } from "../test/render-app.js";
import { scenarioChannels, scenarioDashboard } from "../test/scenario.js";
import { describeActivity } from "./ActivityFeed.js";

const NOW = Date.now();
const RIDGE = 195939070;
let nextId = 1;

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: nextId++,
    connectionId: 1,
    time: NOW - 60_000,
    kind: "node.new",
    nodeNum: null,
    messageId: null,
    value: null,
    detail: null,
    ...overrides,
  };
}

const emptyTraffic: TrafficDTO = {
  window: "24h",
  bucketMs: 3_600_000,
  from: 0,
  to: 1,
  buckets: [],
  ports: [],
  topNodes: [],
};

async function renderFeed(events: ActivityEvent[], nextBefore: number | null = null) {
  const page: ActivityPage = { events, nextBefore };
  return renderApp("/dashboard", {
    dashboard: scenarioDashboard("dashboard", NOW),
    channels: scenarioChannels("dashboard"),
    queries: [
      [queryKeys.activity(1), page],
      [queryKeys.traffic(1, "24h"), emptyTraffic],
    ],
  });
}

const items = () => [...document.querySelectorAll<HTMLElement>('[data-mt="activity-item"]')];

describe("describeActivity", () => {
  it("phrases each kind", () => {
    const name = (i: number) => (i === 0 ? "Primary" : `channel ${i}`);
    expect(
      [
        event({ kind: "message.in", value: 0, detail: "hi all" }),
        event({ kind: "message.in", nodeNum: RIDGE, detail: "psst" }),
        event({ kind: "message.out", detail: "on my way" }),
        event({ kind: "node.new" }),
        event({ kind: "node.back", value: 25 * 3600_000 }),
        event({ kind: "power.changed", detail: "ok→low", value: 18 }),
        event({ kind: "power.changed", detail: "critical→external", value: 101 }),
        event({ kind: "connection.lost", detail: "link closed (peer-closed)" }),
        event({ kind: "connection.restored", value: 90_000 }),
      ].map((e) => describeActivity(e, name)),
    ).toEqual([
      "Message on Primary “hi all”",
      "Direct message “psst”",
      "You sent “on my way”",
      "New node discovered",
      "Heard again after 1d 1h",
      "Battery low (18%)",
      "On external power",
      "Connection lost (link closed (peer-closed))",
      "Connection restored after 1m",
    ]);
  });
});

describe("<ActivityFeed />", () => {
  it("lists events newest first with sources, links and times", async () => {
    await renderFeed([
      event({
        kind: "message.in",
        nodeNum: RIDGE,
        value: 1,
        detail: "ridge here",
        time: NOW - 5_000,
      }),
      event({ kind: "connection.restored", value: 30_000, time: NOW - 60_000 }),
    ]);
    expect(items()).toHaveLength(2);
    expectDataMt(items()[0] ?? null, "activity-item", { variant: "message.in" });
    const first = within(items()[0] as HTMLElement);
    expect(first.getByRole("button", { name: "Ridge Repeater" })).toBeInTheDocument();
    expect(first.getByRole("link", { name: "Message on Friends “ridge here”" })).toHaveAttribute(
      "href",
      "/channels/1",
    );
    expect(items()[0]?.querySelector("time")).toHaveTextContent("5 s ago");
    expect(items()[1]).toHaveTextContent("My nodeConnection restored after 30s");
  });

  it("clicking a node opens its details", async () => {
    const user = userEvent.setup();
    await renderFeed([event({ kind: "node.back", nodeNum: RIDGE, value: 26 * 3600_000 })]);
    await user.click(screen.getByRole("button", { name: "Ridge Repeater" }));
    expect(useUiStore.getState().selectedNode).toBe(RIDGE);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("new events arrive live at the top, once", async () => {
    const { queryClient } = await renderFeed([event({ kind: "node.new", nodeNum: RIDGE })]);
    const fresh = event({ kind: "message.out", detail: "hello", time: NOW });
    act(() => {
      applyServerMessage(queryClient, { type: "activity.new", activity: fresh });
      applyServerMessage(queryClient, { type: "activity.new", activity: fresh });
    });
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    expect(items()[0]).toHaveTextContent("You sent “hello”");
  });

  it("keeps the cache bounded and the cursor at the oldest kept event", async () => {
    const many = Array.from({ length: ACTIVITY_CACHE_LIMIT }, () => event({}));
    const { queryClient } = await renderFeed(many.reverse(), 1);
    act(() => {
      applyServerMessage(queryClient, { type: "activity.new", activity: event({}) });
    });
    const cached = queryClient.getQueryData<ActivityPage>(queryKeys.activity(1));
    expect(cached?.events).toHaveLength(ACTIVITY_CACHE_LIMIT);
    expect(cached?.nextBefore).toBe(cached?.events.at(-1)?.id);
  });

  it("explains itself when there's nothing yet", async () => {
    await renderFeed([]);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
  });
});
