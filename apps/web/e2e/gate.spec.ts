// The base-app gate (implementation plan, Step 11.1): two browsers stay in sync while
// chatting through a node, the app recovers on its own from a node reboot, history
// survives a server restart, and nothing is transmitted beyond the two sends.
//
// This spec owns its processes: FakeNode (its CLI) and the built server bundle
// (apps/server/dist/main.js), so it can restart the server for real.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { controlClient, RIDGE } from "./control.js";
import { GATE_APP_PORT, GATE_CONTROL_PORT, GATE_NODE_PORT } from "./ports.js";
import { ManagedProcess, REPO_ROOT, waitUntil } from "./processes.js";

const BASE = `http://127.0.0.1:${GATE_APP_PORT}`;
const node = controlClient(GATE_CONTROL_PORT);

let dataDir: string;
let fakeNode: ManagedProcess;
let server: ManagedProcess;

async function serverConnected(): Promise<boolean> {
  const res = await fetch(`${BASE}/healthz`);
  const body = (await res.json()) as { connections: { state: string }[] };
  return body.connections[0]?.state === "connected";
}

async function startServer(): Promise<void> {
  server.start();
  await waitUntil(serverConnected, 20_000, () => server.tail());
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "meshterm-gate-"));
  fakeNode = new ManagedProcess(
    "fake-node",
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "serve",
      "--port",
      String(GATE_NODE_PORT),
      "--control-port",
      String(GATE_CONTROL_PORT),
    ],
    { cwd: join(REPO_ROOT, "packages", "fake-node") },
  );
  server = new ManagedProcess("server", ["dist/main.js"], {
    cwd: join(REPO_ROOT, "apps", "server"),
    env: {
      MESHTERM_NODE_HOST: "127.0.0.1",
      MESHTERM_NODE_PORT: String(GATE_NODE_PORT),
      MESHTERM_HTTP_PORT: String(GATE_APP_PORT),
      MESHTERM_DATA_DIR: dataDir,
      MESHTERM_LOG_LEVEL: "warn",
      MESHTERM_BACKOFF_MIN_MS: "200",
      MESHTERM_BACKOFF_MAX_MS: "1000",
    },
  });
  fakeNode.start();
  await waitUntil(
    async () => (await node.inbound()).counts.handshake >= 0,
    20_000,
    () => fakeNode.tail(),
  );
  await startServer();
});

test.afterAll(async () => {
  await server.stop();
  await fakeNode.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const pill = (page: Page) => page.locator("[data-mt=status-pill]");
const outMessage = (page: Page, text: string) =>
  page.locator("[data-mt=message][data-mt-variant=out]", { hasText: text });

async function send(page: Page, text: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

test("base-app gate: sync, reboot recovery, restart persistence, no stray transmits", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const run = `${Date.now()}`;
  const first = `gate first ${run}`;
  const fromMesh = `gate from the mesh ${run}`;
  const second = `gate second ${run}`;

  // 1. Two separate browser contexts on channel 0.
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  for (const page of [a, b]) {
    await page.goto(`${BASE}/channels/0`);
    await expect(pill(page)).toHaveAttribute("data-mt-state", "connected");
  }
  await node.setAckMode("ack");
  await node.clearInbound();

  await test.step("2. A sends; both contexts see it reach acked", async () => {
    await send(a, first);
    for (const page of [a, b]) {
      await expect(outMessage(page, first)).toHaveAttribute("data-mt-state", "acked");
    }
  });

  await test.step("3. a message from the mesh shows in both contexts", async () => {
    await node.injectText(RIDGE, { channel: 0 }, fromMesh);
    for (const page of [a, b]) {
      await expect(
        page.locator("[data-mt=message][data-mt-variant=in]", { hasText: fromMesh }),
      ).toBeVisible();
    }
  });

  await test.step("4. node reboot: both pills go reconnecting, then connected, without a reload", async () => {
    await node.reboot(5_000);
    for (const page of [a, b]) {
      await expect(pill(page)).toHaveAttribute("data-mt-state", "reconnecting", {
        timeout: 5_000,
      });
    }
    for (const page of [a, b]) {
      await expect(pill(page)).toHaveAttribute("data-mt-state", "connected", { timeout: 20_000 });
    }
  });

  await test.step("5. B sends after recovery, and it succeeds", async () => {
    await send(b, second);
    for (const page of [a, b]) {
      await expect(outMessage(page, second)).toHaveAttribute("data-mt-state", "acked");
    }
  });

  await test.step("6. restart the server process; after a reload all three messages are there", async () => {
    await server.stop();
    await startServer();
    for (const page of [a, b]) {
      await page.reload();
      await expect(pill(page)).toHaveAttribute("data-mt-state", "connected");
      for (const text of [first, fromMesh, second]) {
        await expect(page.locator("[data-mt=message]", { hasText: text })).toBeVisible();
      }
    }
  });

  await test.step("7. transmit audit: exactly the two sends, otherwise only handshakes and heartbeats", async () => {
    const audit = await node.inbound();
    expect(audit.counts.transmit).toBe(2);
    expect(audit.counts.other).toBe(0);
    expect(audit.transmits.map((t) => t.text)).toEqual([first, second]);
    expect(audit.transmits.every((t) => t.to === 0xffff_ffff && t.channel === 0)).toBe(true);
    // The node reboot and the server restart each forced a fresh handshake.
    expect(audit.counts.handshake).toBeGreaterThanOrEqual(2);
  });

  await contextA.close();
  await contextB.close();
});
