// FakeNode command line, for local development and docker compose.
//
//   serve   [--port 4403] [--host 127.0.0.1] [--scenario default|busy|<file.json>]
//           [--control-port 4404] [--control-host 127.0.0.1]
//   inject  --text "hello" [--from 195939070] [--channel 0 | --to <nodeNum>]
//           [--control http://127.0.0.1:4404]
//   inject-telemetry [--from N] (--battery N [--voltage V] | --temperature C [--humidity %] [--pressure hPa])
//   inject-position  [--from N] --lat D --lon D [--alt M] [--precision BITS]
//
// `serve` is the default command. `inject` asks a running FakeNode (through its
// control port) to deliver a text message to its clients, as if heard on the mesh.
import { parseArgs } from "node:util";
import { DEFAULT_CONTROL_PORT, startControlServer } from "./control-server.js";
import { FakeNode } from "./fake-node.js";

const RIDGE = 0x0badcafe;

const [command = "serve", ...rest] = process.argv.slice(2);

async function serve(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", default: "4403" },
      host: { type: "string", default: "127.0.0.1" },
      scenario: { type: "string", default: "default" },
      "control-port": { type: "string", default: String(DEFAULT_CONTROL_PORT) },
      "control-host": { type: "string", default: "127.0.0.1" },
    },
  });
  const node = new FakeNode({
    port: Number(values.port),
    host: values.host,
    scenario: values.scenario,
  });
  const port = await node.start();
  const control = startControlServer(node, Number(values["control-port"]), values["control-host"]);
  console.log(`FakeNode "${node.scenarioName}" listening on ${values.host}:${port}`);
  console.log(`FakeNode control API on ${values["control-host"]}:${values["control-port"]}`);

  const stop = () => {
    control.close();
    void node.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function inject(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      text: { type: "string" },
      from: { type: "string", default: String(RIDGE) },
      channel: { type: "string" },
      to: { type: "string" },
      control: { type: "string", default: `http://127.0.0.1:${DEFAULT_CONTROL_PORT}` },
    },
  });
  if (!values.text) throw new Error("inject: --text is required");
  const target = values.to ? { to: Number(values.to) } : { channel: Number(values.channel ?? 0) };
  const res = await fetch(`${values.control}/inject-text`, {
    method: "POST",
    body: JSON.stringify({ from: Number(values.from), target, text: values.text }),
  });
  if (!res.ok) throw new Error(`inject failed: ${res.status} ${await res.text()}`);
  console.log(`injected: ${await res.text()}`);
}

async function control(url: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${url}${path}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  console.log(`injected: ${await res.text()}`);
}

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

async function injectTelemetry(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: "string", default: String(RIDGE) },
      battery: { type: "string" },
      voltage: { type: "string" },
      temperature: { type: "string" },
      humidity: { type: "string" },
      pressure: { type: "string" },
      control: { type: "string", default: `http://127.0.0.1:${DEFAULT_CONTROL_PORT}` },
    },
  });
  const body =
    values.temperature !== undefined
      ? {
          from: Number(values.from),
          environment: {
            temperature: num(values.temperature),
            relativeHumidity: num(values.humidity),
            barometricPressure: num(values.pressure),
          },
        }
      : {
          from: Number(values.from),
          device: { batteryLevel: num(values.battery), voltage: num(values.voltage) },
        };
  await control(values.control, "/inject-telemetry", body);
}

async function injectPosition(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      from: { type: "string", default: String(RIDGE) },
      lat: { type: "string" },
      lon: { type: "string" },
      alt: { type: "string" },
      precision: { type: "string" },
      control: { type: "string", default: `http://127.0.0.1:${DEFAULT_CONTROL_PORT}` },
    },
  });
  if (values.lat === undefined || values.lon === undefined) {
    throw new Error("inject-position: --lat and --lon are required");
  }
  await control(values.control, "/inject-position", {
    from: Number(values.from),
    lat: Number(values.lat),
    lon: Number(values.lon),
    altitude: num(values.alt),
    precisionBits: num(values.precision),
  });
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  serve,
  inject,
  "inject-telemetry": injectTelemetry,
  "inject-position": injectPosition,
};
const run = commands[command];
if (!run) {
  console.error(`unknown command "${command}"; use serve or inject`);
  process.exit(2);
}
await run(rest);
