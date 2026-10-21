import type { ConfigSchemaDTO, DeviceConfigDTO, MapNodesDTO } from "@meshterm/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../data/keys.js";
import { renderApp } from "../../test/render-app.js";
import { useEditsStore } from "./edits.js";

const SCHEMA: ConfigSchemaDTO = {
  owner: [],
  config: { position: [{ name: "fixedPosition", kind: "bool", list: false }] },
  moduleConfig: {},
  channel: [],
};

const config: DeviceConfigDTO = {
  connectionId: 1,
  version: "v1",
  receivedAt: 0,
  myNodeNum: 1,
  firmware: null,
  owner: { shortName: "MTB" },
  config: { position: { fixedPosition: false } },
  moduleConfig: {},
  channels: [],
  secretsMasked: false,
};

const mapNodes = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: 1,
      geometry: { type: "Point", coordinates: [-122.25, 47.5] },
      properties: { num: 1, isSelf: true },
    },
  ],
  unplaced: [],
  thresholds: { onlineMinutes: 15, recentMinutes: 60, staleMinutes: 1440 },
} as unknown as MapNodesDTO;

let posted: unknown[] = [];
beforeEach(() => {
  useEditsStore.setState({ connectionId: null, edits: {}, applyId: null });
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/config/apply")) {
        posted.push(JSON.parse(init?.body as string));
        return Promise.resolve(new Response("{}", { status: 409 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fixed position", () => {
  it("starts from the node's position and sends set_fixed_position", async () => {
    const user = userEvent.setup();
    await renderApp("/settings/device?section=position", {
      queries: [
        [queryKeys.configSchema, SCHEMA],
        [queryKeys.deviceConfig(1), config],
        [queryKeys.mapNodes(1), mapNodes],
      ],
    });
    expect(screen.queryByLabelText("Latitude")).not.toBeInTheDocument();
    await user.click(await screen.findByLabelText("Fixed position"));
    expect(screen.getByLabelText("Latitude")).toHaveValue(47.5);
    expect(screen.getByLabelText("Longitude")).toHaveValue(-122.25);
    expect(screen.getByRole("button", { name: "Pick on map…" })).toBeInTheDocument();
    const alt = screen.getByLabelText("Altitude (m)");
    await user.type(alt, "120");
    await user.click(screen.getByRole("button", { name: "Review & apply" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Apply 2 changes" }));
    expect(posted).toEqual([
      {
        baseVersion: "v1",
        changes: {
          config: { position: { fixedPosition: true } },
          fixedPosition: { lat: 47.5, lon: -122.25, alt: 120 },
        },
      },
    ]);
  });
});
