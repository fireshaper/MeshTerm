/** Shared e2e server (serve.ts) used by most specs. */
export const E2E_PORT = 4174;
/** Its FakeNode's control API. */
export const CONTROL_PORT = 4175;

/** A second serve.ts instance just for visual baselines, so other specs can't change what it shows. */
export const VISUAL_PORT = 4176;
export const VISUAL_CONTROL_PORT = 4177;

/** serve.ts on the `dashboard` scenario (dashboard specs), and another just for its baselines. */
export const DASHBOARD_PORT = 4178;
export const DASHBOARD_CONTROL_PORT = 4179;
export const VISUAL_DASHBOARD_PORT = 4186;
export const VISUAL_DASHBOARD_CONTROL_PORT = 4187;

/** serve.ts on the `dashboard` scenario with 30 days of telemetry history (read-only for specs). */
export const HISTORY_PORT = 4192;
export const HISTORY_CONTROL_PORT = 4193;

/** serve.ts on the generated 300-node `large` scenario. */
export const LARGE_PORT = 4184;
export const LARGE_CONTROL_PORT = 4185;

/** The gate spec runs its own FakeNode and server processes on these. */
export const GATE_APP_PORT = 4180;
export const GATE_NODE_PORT = 4190;
export const GATE_CONTROL_PORT = 4191;
