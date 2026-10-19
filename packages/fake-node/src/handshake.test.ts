import { afterEach, describe, expect, it } from "vitest";
import type { FromRadio } from "@meshterm/protocol";
import { FakeNode } from "./fake-node.js";
import { loadScenario, parseScenario } from "./scenario.js";
import { RawClient } from "./test-client.js";

let node: FakeNode | undefined;
let client: RawClient | undefined;

afterEach(async () => {
  client?.close();
  await node?.stop();
});

async function handshake(scenario: string, nonce: number): Promise<FromRadio[]> {
  node = new FakeNode({ scenario, now: () => 1_800_000_000_000 });
  await node.start();
  client = await RawClient.open(node.port);
  client.send({ payloadVariant: { case: "wantConfigId", value: nonce } });
  await client.waitFor((r) => r.at(-1)?.payloadVariant.case === "configCompleteId");
  return client.received;
}

const cases = (msgs: FromRadio[]) => msgs.map((m) => m.payloadVariant.case);

describe("config handshake", () => {
  it("replies to want_config_id = 42 in order, ending with config_complete_id = 42", async () => {
    const msgs = await handshake("default", 42);
    expect(cases(msgs)).toEqual([
      "myInfo",
      "nodeInfo",
      "metadata",
      "channel",
      "channel",
      ...Array<string>(8).fill("config"),
      "moduleConfig",
      "moduleConfig",
      "nodeInfo",
      "nodeInfo",
      "nodeInfo",
      "configCompleteId",
    ]);
    expect(msgs.at(-1)?.payloadVariant).toEqual({ case: "configCompleteId", value: 42 });

    const [myInfo, ownNode] = msgs;
    expect(myInfo?.payloadVariant.case === "myInfo" && myInfo.payloadVariant.value.myNodeNum).toBe(
      0xa1b2c3d4,
    );
    expect(ownNode?.payloadVariant.case === "nodeInfo" && ownNode.payloadVariant.value.num).toBe(
      0xa1b2c3d4,
    );

    const channels = msgs.flatMap((m) =>
      m.payloadVariant.case === "channel" ? [m.payloadVariant.value] : [],
    );
    expect(channels.map((c) => [c.index, c.role])).toEqual([
      [0, 1], // PRIMARY
      [1, 2], // SECONDARY
    ]);

    // FromRadio ids are unique and increasing, like the firmware's.
    const ids = msgs.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("computes lastHeard from lastHeardAgoS at send time", async () => {
    const msgs = await handshake("default", 1);
    const ridge = msgs.find(
      (m) => m.payloadVariant.case === "nodeInfo" && m.payloadVariant.value.num === 0x0badcafe,
    );
    expect(ridge?.payloadVariant.case === "nodeInfo" && ridge.payloadVariant.value.lastHeard).toBe(
      1_800_000_000 - 45,
    );
  });

  it("a different scenario changes the node count", async () => {
    const msgs = await handshake("busy", 7);
    expect(cases(msgs).filter((c) => c === "nodeInfo")).toHaveLength(8);
    expect(msgs.at(-1)?.payloadVariant).toEqual({ case: "configCompleteId", value: 7 });
  });
});

describe("scenario parsing", () => {
  it("loads every built-in scenario", () => {
    expect(loadScenario("default").nodes).toHaveLength(4);
    expect(loadScenario("busy").nodes).toHaveLength(8);
  });

  it("rejects a scenario without an entry for its own node", () => {
    const bad = {
      name: "bad",
      myInfo: { myNodeNum: 1 },
      metadata: {},
      nodes: [{ num: 2 }],
      channels: [],
      config: [],
      moduleConfig: [],
    };
    expect(() => parseScenario(bad)).toThrow(/myNodeNum 1/);
  });

  it("rejects unknown protobuf fields", () => {
    const bad = {
      name: "bad",
      myInfo: { myNodeNum: 1, notAField: true },
      metadata: {},
      nodes: [{ num: 1 }],
      channels: [],
      config: [],
      moduleConfig: [],
    };
    expect(() => parseScenario(bad)).toThrow();
  });
});
