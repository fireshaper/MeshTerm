/** Shared e2e server (serve.ts) used by most specs. */
export const E2E_PORT = 4174;
/** Its FakeNode's control API. */
export const CONTROL_PORT = 4175;

/** A second serve.ts instance just for visual baselines, so other specs can't change what it shows. */
export const VISUAL_PORT = 4176;
export const VISUAL_CONTROL_PORT = 4177;

/** The gate spec runs its own FakeNode and server processes on these. */
export const GATE_APP_PORT = 4180;
export const GATE_NODE_PORT = 4190;
export const GATE_CONTROL_PORT = 4191;
