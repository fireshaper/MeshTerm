// Standalone FakeNode for local development: `pnpm --filter @meshterm/fake-node serve [--port 4403] [--scenario default]`.
import { parseArgs } from "node:util";
import { FakeNode } from "./fake-node.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4403" },
    host: { type: "string", default: "127.0.0.1" },
    scenario: { type: "string", default: "default" },
  },
});

const node = new FakeNode({
  port: Number(values.port),
  host: values.host,
  scenario: values.scenario,
});
const port = await node.start();
console.log(`FakeNode "${node.scenarioName}" listening on ${values.host}:${port}`);

const stop = () => {
  void node.stop().then(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
