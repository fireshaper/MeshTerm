import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BASE_MAP_KEY, baseTileUrl, MapCredit, readBaseMap } from "./base-map.js";
import { baseSource, buildStyle } from "./map-style.js";
import { readMapTokens } from "./map-tokens.js";

afterEach(() => {
  localStorage.clear();
});

describe("base map", () => {
  it("is topographic unless this browser chose the street map", () => {
    expect(readBaseMap()).toBe("topo");
    localStorage.setItem(BASE_MAP_KEY, "street");
    expect(readBaseMap()).toBe("street");
    localStorage.setItem(BASE_MAP_KEY, "satellite");
    expect(readBaseMap()).toBe("topo");
  });

  it("loads tiles through the server, topographic only up to zoom 17", () => {
    expect(baseTileUrl("topo", 14, 2621, 5718)).toBe("/api/tiles/topo/14/2621/5718.png");
    expect(baseTileUrl("street", 14, 2621, 5718)).toBe("/api/tiles/14/2621/5718.png");
    expect(baseSource("https://m.example", "topo")).toMatchObject({
      tiles: ["https://m.example/api/tiles/topo/{z}/{x}/{y}.png"],
      maxzoom: 17,
    });
    expect(baseSource("https://m.example", "street").maxzoom).toBe(19);
    const style = buildStyle("https://m.example", readMapTokens(), null, undefined, "topo");
    expect(style.sources["mt-base"]).toMatchObject({ maxzoom: 17 });
  });

  it("credits OpenTopoMap only for the topographic tiles", () => {
    const topo = render(<MapCredit base="topo" />);
    expect(topo.container).toHaveTextContent(
      "© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)",
    );
    topo.unmount();
    const street = render(<MapCredit base="street" />);
    expect(street.container).toHaveTextContent("© OpenStreetMap contributors");
    expect(street.container).not.toHaveTextContent("OpenTopoMap");
  });
});
