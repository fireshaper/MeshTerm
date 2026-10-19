import { describe, expect, it } from "vitest";
import { decodeFromRadio, decodeToRadio, encodeFromRadio, encodeToRadio } from "./codec.js";

describe("codec", () => {
  it("round-trips a FromRadio my_info node number", () => {
    const bytes = encodeFromRadio({
      payloadVariant: { case: "myInfo", value: { myNodeNum: 0xa1b2c3d4 } },
    });
    const decoded = decodeFromRadio(bytes);
    expect(decoded.payloadVariant.case).toBe("myInfo");
    if (decoded.payloadVariant.case !== "myInfo") return;
    expect(decoded.payloadVariant.value.myNodeNum).toBe(0xa1b2c3d4);
  });

  it("round-trips a ToRadio want_config_id", () => {
    const decoded = decodeToRadio(
      encodeToRadio({ payloadVariant: { case: "wantConfigId", value: 42 } }),
    );
    expect(decoded.payloadVariant).toEqual({ case: "wantConfigId", value: 42 });
  });
});
