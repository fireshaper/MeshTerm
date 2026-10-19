import { NodeTable } from "../components/NodeTable.js";

export function NodesPage() {
  return (
    <section data-mt="node-list">
      <h1 data-mt="page-title">Nodes</h1>
      <NodeTable />
    </section>
  );
}
