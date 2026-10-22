import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const durationMs = z.coerce.number().int().positive();

/** Environment variables read by the server. Names are the public contract; see README. */
export const EnvSchema = z
  .object({
    MESHTERM_NODE_HOST: z.string().trim().min(1),
    MESHTERM_NODE_PORT: port.default(4403),
    MESHTERM_HTTP_PORT: port.default(8080),
    MESHTERM_DATA_DIR: z.string().trim().min(1).default("/data"),
    /** Built SPA (apps/web/dist). Unset: found next to the server; missing: SPA not served. */
    MESHTERM_WEB_DIR: z.string().trim().min(1).optional(),
    /** Built-in themes (repo-root themes/). Unset: found next to the server. */
    MESHTERM_THEMES_DIR: z.string().trim().min(1).optional(),
    /** 1: poll /data/themes instead of file events (NFS/SMB/bind mounts where events are unreliable). */
    MESHTERM_THEMES_POLL: z.enum(["0", "1"]).default("0"),
    MESHTERM_LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    MESHTERM_CONNECT_TIMEOUT_MS: durationMs.default(10_000),
    MESHTERM_TCP_KEEPALIVE_MS: durationMs.default(15_000),
    MESHTERM_CONFIG_TIMEOUT_MS: durationMs.default(30_000),
    MESHTERM_HEARTBEAT_INTERVAL_MS: durationMs.default(60_000),
    MESHTERM_ACK_TIMEOUT_MS: durationMs.default(120_000),
    MESHTERM_BACKOFF_MIN_MS: durationMs.default(2_000),
    MESHTERM_BACKOFF_MAX_MS: durationMs.default(60_000),
    /** Map tile source for the server's tile proxy; {z}/{x}/{y} are substituted. */
    MESHTERM_TILE_URL: z
      .string()
      .trim()
      .pipe(z.url({ protocol: /^https?$/ }))
      .refine((u) => u.includes("{z}") && u.includes("{x}") && u.includes("{y}"), {
        message: "must contain {z}, {x} and {y}",
      })
      .default("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
    /** Size cap of the on-disk tile cache (<data dir>/tiles). */
    MESHTERM_TILE_CACHE_MB: z.coerce.number().positive().default(500),
    /** `local`: accounts and sessions (default). `none`: no login, everyone is an admin. */
    MESHTERM_AUTH: z.enum(["local", "none"]).default("local"),
    /** Optional first admin, created at startup when no accounts exist. */
    MESHTERM_ADMIN_USERNAME: z.string().trim().min(1).optional(),
    MESHTERM_ADMIN_PASSWORD: z.string().min(8).max(256).optional(),
    /** Sessions end after this many days, or after a week without use. */
    MESHTERM_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * 32-byte key (base64 or hex) that encrypts config snapshots. Unset: generated once
     * into <data dir>/secret.key.
     */
    MESHTERM_SECRET_KEY: z.string().trim().min(1).optional(),
  })
  .refine(
    (env) =>
      (env.MESHTERM_ADMIN_USERNAME === undefined) === (env.MESHTERM_ADMIN_PASSWORD === undefined),
    {
      path: ["MESHTERM_ADMIN_PASSWORD"],
      message: "set both MESHTERM_ADMIN_USERNAME and MESHTERM_ADMIN_PASSWORD, or neither",
    },
  )
  .refine((env) => env.MESHTERM_BACKOFF_MAX_MS >= env.MESHTERM_BACKOFF_MIN_MS, {
    path: ["MESHTERM_BACKOFF_MAX_MS"],
    message: "must be greater than or equal to MESHTERM_BACKOFF_MIN_MS",
  });

export const ConfigSchema = EnvSchema.transform((env) => ({
  nodeHost: env.MESHTERM_NODE_HOST,
  nodePort: env.MESHTERM_NODE_PORT,
  httpPort: env.MESHTERM_HTTP_PORT,
  dataDir: env.MESHTERM_DATA_DIR,
  webDir: env.MESHTERM_WEB_DIR ?? null,
  themesDir: env.MESHTERM_THEMES_DIR ?? null,
  themesPoll: env.MESHTERM_THEMES_POLL === "1",
  logLevel: env.MESHTERM_LOG_LEVEL,
  connectTimeoutMs: env.MESHTERM_CONNECT_TIMEOUT_MS,
  tcpKeepAliveMs: env.MESHTERM_TCP_KEEPALIVE_MS,
  configTimeoutMs: env.MESHTERM_CONFIG_TIMEOUT_MS,
  heartbeatIntervalMs: env.MESHTERM_HEARTBEAT_INTERVAL_MS,
  ackTimeoutMs: env.MESHTERM_ACK_TIMEOUT_MS,
  backoffMinMs: env.MESHTERM_BACKOFF_MIN_MS,
  backoffMaxMs: env.MESHTERM_BACKOFF_MAX_MS,
  tileUrl: env.MESHTERM_TILE_URL,
  tileCacheMb: env.MESHTERM_TILE_CACHE_MB,
  auth: env.MESHTERM_AUTH,
  initialAdmin:
    env.MESHTERM_ADMIN_USERNAME !== undefined && env.MESHTERM_ADMIN_PASSWORD !== undefined
      ? { username: env.MESHTERM_ADMIN_USERNAME, password: env.MESHTERM_ADMIN_PASSWORD }
      : null,
  sessionDays: env.MESHTERM_SESSION_DAYS,
  secretKey: env.MESHTERM_SECRET_KEY ?? null,
}));

export type Config = z.output<typeof ConfigSchema>;

export interface ConfigIssue {
  field: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid configuration:\n${issues.map((i) => `  - ${i.field}: ${i.message}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Parses an env-like object into a typed config. Throws `ConfigError` naming every invalid field. */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    })),
  );
}
