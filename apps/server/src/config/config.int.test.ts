// Device config (CR-002 Phase D1) against FakeNode's admin module: read, refresh,
// apply with reboot/verify, no-reboot re-read, clamping, conflicts, passkey retry,
// recovery, viewer masking, snapshots and audit.
import { auditInbound, FakeNode, until } from "@meshterm/fake-node";
import { Config, create } from "@meshterm/protocol";
import type {
  ApplyStatusDTO,
  AuditPage,
  ChannelUrlDTO,
  DeviceConfigDTO,
  MapNodesDTO,
  MeDTO,
  ParsedChannelUrlDTO,
} from "@meshterm/shared";
import { SECRET_MASK } from "@meshterm/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-app.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const app = () => {
  if (!t) throw new Error("no app");
  return t.app;
};

async function start(
  options: {
    env?: Record<string, string>;
    node?: FakeNode;
    grace?: number;
    recovery?: number;
  } = {},
) {
  t = await startTestApp({
    ...(options.node ? { node: options.node } : {}),
    env: options.env ?? {},
    deps: {
      applyTiming: {
        noRebootGraceMs: options.grace ?? 1_500,
        recoveryAfterMs: options.recovery ?? 20_000,
      },
    },
  });
  return t;
}

const getConfig = async (headers: Record<string, string> = {}) => {
  const res = await app().inject({ url: "/api/connections/1/config", headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<DeviceConfigDTO>();
};

let ip = 0;
/** Each apply from a different address: the route allows one per 30 s per client. */
const apply = (body: object, headers: Record<string, string> = {}) =>
  app().inject({
    method: "POST",
    url: "/api/connections/1/config/apply",
    payload: body,
    headers,
    remoteAddress: `10.0.0.${++ip}`,
  });

async function finished(applyId: string): Promise<ApplyStatusDTO> {
  let status: ApplyStatusDTO | null = null;
  await until(() => {
    void app()
      .inject({ url: `/api/connections/1/config/apply/${applyId}` })
      .then((r) => {
        status = r.json<ApplyStatusDTO>();
      });
    return status?.finishedAt != null;
  }, 25_000);
  return status as unknown as ApplyStatusDTO;
}

describe("GET /api/connections/:id/config", () => {
  it("serves the handshake's config as proto JSON, with PSKs, and sends the node nothing", async () => {
    const { node } = await start();
    const c = await getConfig();
    expect(c.version).toMatch(/^[0-9a-f]{16}$/);
    expect(c.owner).toMatchObject({ shortName: "MTB" });
    expect(c.config.lora).toMatchObject({ usePreset: true, modemPreset: "LONG_FAST", hopLimit: 3 });
    expect(c.config.device).toHaveProperty("role", "CLIENT");
    expect(c.channels.map((ch) => (ch.settings as { name: string }).name)).toEqual(["", "Friends"]);
    expect((c.channels[1]?.settings as { psk: string }).psk.length).toBeGreaterThan(10);
    expect(c.secretsMasked).toBe(false);
    // Reading the config never talks to the node's admin module.
    expect(node.admin.log).toEqual([]);
    expect(auditInbound(node.inbound, node.myNodeNum).counts.admin).toBe(0);
  });

  it("viewers get secrets masked and can't apply or refresh", async () => {
    await start({ env: { MESHTERM_AUTH: "local" } });
    const setup = await app().inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { username: "alice", password: "correct horse" },
    });
    const adminCookie = `mt_session=${setup.cookies.find((x) => x.name === "mt_session")?.value ?? ""}`;
    const me = (
      await app().inject({ url: "/api/auth/me", headers: { cookie: adminCookie } })
    ).json<MeDTO>();
    await app().inject({
      method: "POST",
      url: "/api/users",
      payload: { username: "vic", password: "just-looking", role: "viewer" },
      headers: { cookie: adminCookie, "x-csrf-token": me.csrfToken },
    });
    const login = await app().inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "vic", password: "just-looking" },
    });
    const cookie = `mt_session=${login.cookies.find((x) => x.name === "mt_session")?.value ?? ""}`;
    const csrf = (await app().inject({ url: "/api/auth/me", headers: { cookie } })).json<MeDTO>()
      .csrfToken;
    const masked = await getConfig({ cookie });
    expect(masked.secretsMasked).toBe(true);
    expect((masked.channels[1]?.settings as { psk: string }).psk).toBe(SECRET_MASK);
    const res = await apply(
      { baseVersion: masked.version, changes: { config: { lora: { hopLimit: 4 } } } },
      { cookie, "x-csrf-token": csrf },
    );
    expect(res.statusCode).toBe(403);
    // The channel link holds the keys.
    const link = await app().inject({
      url: "/api/connections/1/channels/url",
      headers: { cookie },
    });
    expect(link.statusCode).toBe(403);
  });
});

describe("channel links (CR-002 Phase D3)", () => {
  it("exports enabled channels with LoRa settings and a QR code, reads them back, audits it", async () => {
    const { node } = await start();
    const res = await app().inject({ url: "/api/connections/1/channels/url?indexes=1,0" });
    expect(res.statusCode, res.body).toBe(200);
    const { url, qr } = res.json<ChannelUrlDTO>();
    expect(url).toMatch(/^https:\/\/meshtastic\.org\/e\/#[A-Za-z0-9_-]+$/);
    expect(qr.path.length).toBeGreaterThan(100);
    const parsed = await app().inject({
      method: "POST",
      url: "/api/connections/1/channels/url/parse",
      payload: { url },
    });
    expect(parsed.statusCode).toBe(200);
    const body = parsed.json<ParsedChannelUrlDTO>();
    // The primary comes first whatever order was asked for.
    expect(body.settings.map((x) => x.name)).toEqual(["", "Friends"]);
    expect(body.lora).toMatchObject({ region: "US", modemPreset: "LONG_FAST" });
    const loraOff = await app().inject({ url: "/api/connections/1/channels/url?lora=false" });
    expect(
      (
        await app().inject({
          method: "POST",
          url: "/api/connections/1/channels/url/parse",
          payload: { url: loraOff.json<ChannelUrlDTO>().url },
        })
      ).json<ParsedChannelUrlDTO>().lora,
    ).toBeNull();
    const auditPage = (await app().inject({ url: "/api/audit" })).json<AuditPage>();
    expect(auditPage.entries.find((e) => e.action === "channels.export")?.details).toEqual({
      indexes: [0, 1],
    });
    // Reading and encoding never talks to the node.
    expect(auditInbound(node.inbound, node.myNodeNum).counts).toMatchObject({
      admin: 0,
      transmit: 0,
    });
  });

  it("refuses links that aren't channel links, and makes random keys", async () => {
    await start();
    const bad = await app().inject({
      method: "POST",
      url: "/api/connections/1/channels/url/parse",
      payload: { url: "https://example.com/" },
    });
    expect(bad.statusCode).toBe(400);
    const key = await app().inject({ url: "/api/config/random-psk?bits=128" });
    expect(Buffer.from(key.json<{ psk: string }>().psk, "base64")).toHaveLength(16);
  });

  it("applies a channel and a fixed position: setChannel and setFixedPosition, verified", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 600 });
    await start({ node });
    const before = await getConfig();
    const friends = before.channels.find((c) => c.index === 1) as Record<string, unknown>;
    const res = await apply({
      baseVersion: before.version,
      changes: {
        channels: [
          {
            ...friends,
            settings: { ...(friends.settings as object), name: "Hikers", uplinkEnabled: true },
          },
          { index: 2, role: "SECONDARY", settings: { name: "Ops", psk: "AQ==" } },
        ],
        config: { position: { fixedPosition: true } },
        fixedPosition: { lat: 47.6, lon: -122.3, alt: 50 },
      },
    });
    expect(res.statusCode, res.body).toBe(202);
    const done = await finished(res.json<ApplyStatusDTO>().applyId);
    expect(done.phase, JSON.stringify(done)).toBe("verified");
    expect(done.paths).toEqual(
      expect.arrayContaining([
        "channels.1.settings.name",
        "channels.1.settings.uplinkEnabled",
        "channels.2.role",
        "fixedPosition",
      ]),
    );
    const after = await getConfig();
    expect(after.channels.map((c) => (c.settings as { name: string }).name)).toEqual([
      "",
      "Hikers",
      "Ops",
    ]);
    expect(node.admin.log).toEqual(
      expect.arrayContaining(["setChannel", "setChannel", "setFixedPosition"]),
    );
    // The node reported the new position in the handshake after its reboot.
    const map = (await app().inject({ url: "/api/connections/1/map/nodes" })).json<MapNodesDTO>();
    const self = map.features.find((f) => f.properties.isSelf);
    expect(self?.geometry.coordinates).toEqual([-122.3, 47.6]);
  });
});

describe("POST /api/connections/:id/config/apply", () => {
  it("begin → sets in order → commit, reboot, reconnect, verified; snapshot and audit", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 600 });
    const { app: a } = await start({ node });
    const before = await getConfig();
    const res = await apply({
      baseVersion: before.version,
      changes: {
        owner: { longName: "MeshTerm Base 2" },
        config: { lora: { hopLimit: 4 }, device: { role: "CLIENT_MUTE" } },
        moduleConfig: { telemetry: { deviceUpdateInterval: 900 } },
        channels: [
          {
            ...before.channels[1],
            settings: { ...(before.channels[1]?.settings as object), name: "Pals" },
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(202);
    const started = res.json<ApplyStatusDTO>();
    expect(started.phase).toBe("applying");
    expect(started.paths).toEqual(
      expect.arrayContaining([
        "owner.longName",
        "config.lora.hopLimit",
        "config.device.role",
        "moduleConfig.telemetry.deviceUpdateInterval",
        "channels.1.settings.name",
      ]),
    );

    const done = await finished(started.applyId);
    expect(done.phase, done.error ?? "").toBe("verified");
    expect(node.admin.log).toEqual([
      "getOwnerRequest",
      "beginEditSettings",
      "setOwner",
      "setChannel",
      "setConfig",
      "setConfig",
      "setModuleConfig",
      "commitEditSettings",
    ]);
    const after = await getConfig();
    expect(after.version).not.toBe(before.version);
    expect(after.config.lora).toMatchObject({ hopLimit: 4 });
    expect(after.config.device).toMatchObject({ role: "CLIENT_MUTE" });
    expect(after.moduleConfig.telemetry).toMatchObject({ deviceUpdateInterval: 900 });
    expect(after.owner).toMatchObject({ longName: "MeshTerm Base 2" });
    expect((after.channels[1]?.settings as { name: string }).name).toBe("Pals");
    // The node's admin traffic is all local: nothing went out on the mesh.
    expect(auditInbound(node.inbound, node.myNodeNum).counts.transmit).toBe(0);

    const snaps = (await a.inject({ url: "/api/connections/1/config/snapshots" })).json<
      { id: number; reason: string }[]
    >();
    expect(snaps.map((s) => s.reason)).toEqual(["pre-apply"]);
    const snap = (
      await a.inject({ url: `/api/connections/1/config/snapshots/${snaps[0]?.id}` })
    ).json<{ config: { lora: { hopLimit: number } } }>();
    expect(snap.config.lora.hopLimit).toBe(3);

    const audit = (await a.inject({ url: "/api/audit" })).json<AuditPage>().entries;
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(["config.apply.start", "config.apply"]),
    );
    // Paths only, never values: no PSK appears in the audit log.
    const psk = (before.channels[1]?.settings as { psk: string }).psk;
    expect(JSON.stringify(audit)).not.toContain(psk);
    expect(audit.find((e) => e.action === "config.apply")?.details?.paths).toContain(
      "channels.1.settings.name",
    );
    expect(audit.find((e) => e.action === "config.apply")?.details?.paths).not.toContain(
      "channels.1.settings.psk",
    );
  }, 40_000);

  it("a change that needs no reboot: re-read and verified", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 0 });
    await start({ node, grace: 500 });
    const before = await getConfig();
    const res = await apply({
      baseVersion: before.version,
      changes: { config: { display: { screenOnSecs: 120 } } },
    });
    const done = await finished(res.json<ApplyStatusDTO>().applyId);
    expect(done.phase).toBe("verified");
    expect(node.admin.log.at(-1)).toBe("getConfigRequest");
    expect((await getConfig()).config.display).toMatchObject({ screenOnSecs: 120 });
  });

  it("a value the firmware clamps is reported as a mismatch", async () => {
    const node = new FakeNode();
    node.setAdminOptions({
      rebootOnCommitMs: 300,
      clamp: (c) =>
        c.payloadVariant.case === "lora" && c.payloadVariant.value.txPower > 20
          ? create(Config.ConfigSchema, {
              payloadVariant: { case: "lora", value: { ...c.payloadVariant.value, txPower: 20 } },
            })
          : c,
    });
    await start({ node });
    const before = await getConfig();
    const res = await apply({
      baseVersion: before.version,
      changes: { config: { lora: { txPower: 30 } } },
    });
    const done = await finished(res.json<ApplyStatusDTO>().applyId);
    expect(done.phase).toBe("mismatched");
    expect(done.mismatches).toEqual([{ path: "config.lora.txPower", sent: 30, actual: 20 }]);
  }, 30_000);

  it("an expired passkey is refreshed and the set retried once", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 0, expirePasskeyOnBegin: true });
    await start({ node, grace: 300 });
    const before = await getConfig();
    const res = await apply({
      baseVersion: before.version,
      changes: { config: { display: { screenOnSecs: 45 } } },
    });
    const done = await finished(res.json<ApplyStatusDTO>().applyId);
    expect(done.phase, done.error ?? "").toBe("verified");
    expect(node.admin.log.slice(0, 5)).toEqual([
      "getOwnerRequest",
      "beginEditSettings",
      "setConfig",
      "getOwnerRequest",
      "setConfig",
    ]);
  });

  it("refuses a stale baseVersion, a second apply while one runs, and invalid fields", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 2_000 });
    await start({ node });
    const before = await getConfig();
    expect(
      (
        await apply({
          baseVersion: "0000000000000000",
          changes: { config: { lora: { hopLimit: 4 } } },
        })
      ).statusCode,
    ).toBe(409);
    const bad = await apply({
      baseVersion: before.version,
      changes: { config: { lora: { notAField: 1 } } },
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await apply({ baseVersion: before.version, changes: { config: { sessionkey: {} } } }))
        .statusCode,
    ).toBe(400);
    const first = await apply({
      baseVersion: before.version,
      changes: { config: { lora: { hopLimit: 5 } } },
    });
    expect(first.statusCode).toBe(202);
    const second = await apply({
      baseVersion: before.version,
      changes: { config: { lora: { hopLimit: 6 } } },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: string }>().error).toBe("apply_in_progress");
    await finished(first.json<ApplyStatusDTO>().applyId);
  }, 30_000);

  it("a node that doesn't come back ends in recovery", async () => {
    const node = new FakeNode();
    node.setAdminOptions({ rebootOnCommitMs: 60_000 });
    await start({ node, recovery: 1_500 });
    const before = await getConfig();
    const res = await apply({
      baseVersion: before.version,
      changes: { config: { lora: { hopLimit: 4 } } },
    });
    const done = await finished(res.json<ApplyStatusDTO>().applyId);
    expect(done.phase).toBe("recovery");
    expect(done.error).toMatch(/didn't come back/);
  }, 30_000);
});

describe("POST /api/connections/:id/config/refresh", () => {
  it("re-reads owner, channels, config and modules from the node", async () => {
    const { node } = await start();
    const res = await app().inject({ method: "POST", url: "/api/connections/1/config/refresh" });
    expect(res.statusCode, res.body).toBe(200);
    expect(node.admin.log[0]).toBe("getOwnerRequest");
    expect(node.admin.log.filter((c) => c === "getChannelRequest")).toHaveLength(8);
    expect(node.admin.log).toContain("getModuleConfigRequest");
    // Only reads: nothing was set.
    expect(node.admin.log.every((c) => c.startsWith("get"))).toBe(true);
  }, 30_000);
});
