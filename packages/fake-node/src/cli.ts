// FakeNode command line, for local development and docker compose.
//
//   serve   [--port 4403] [--host 127.0.0.1] [--scenario default|busy|<file.json>]
//           [--control-port 4404] [--control-host 127.0.0.1]
//   inject  --text "hello" [--from 195939070] [--channel 0 | --to <nodeNum>]
//           [--control http://127.0.0.1:4404]
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

const commands: Record<string, (args: string[]) => Promise<void>> = { serve, inject };
const run = commands[command];
if (!run) {
  console.error(`unknown command "${command}"; use serve or inject`);
  process.exit(2);
}
await run(rest);
