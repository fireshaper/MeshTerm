import { relative, sep } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { Hub } from "../events/events.js";
import { silentLogger, type Logger } from "../logger.js";
import type { ThemeRegistry } from "./registry.js";

/** Changes to one theme folder within this long count as one edit (CR-004 §4.3). */
export const THEME_DEBOUNCE_MS = 300;

export interface ThemeWatcherOptions {
  registry: ThemeRegistry;
  hub: Hub;
  /** Poll instead of file events (`MESHTERM_THEMES_POLL=1`, for NFS/SMB/bind mounts). */
  poll?: boolean;
  logger?: Logger;
}

/**
 * Hot reload: watches /data/themes, rescans a folder once its changes settle and
 * publishes `theme.changed` when what's served for that id changed.
 */
export class ThemeWatcher {
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly logger: Logger;

  constructor(private readonly options: ThemeWatcherOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  /** Resolves once the initial scan of the folder is done (events after that count). */
  start(): Promise<void> {
    const dir = this.options.registry.userDir;
    if (!dir) return Promise.resolve();
    const watcher = watch(dir, {
      ignoreInitial: true,
      depth: 5,
      usePolling: this.options.poll ?? false,
      interval: 500,
      // Wait for writes to finish so a half-copied file isn't hashed.
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher = watcher;
    watcher.on("all", (_event, path) => {
      const id = relative(dir, path).split(sep)[0];
      if (id && !id.startsWith(".") && id !== "..") this.schedule(id);
    });
    watcher.on("error", (err) => {
      this.logger.warn({ err }, "theme watcher error");
    });
    return new Promise((resolve) => {
      watcher.once("ready", () => {
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.watcher?.close();
    this.watcher = null;
  }

  /** Rescans now (also used after Duplicate, which shouldn't wait for the watcher). */
  refresh(id: string): void {
    const { registry, hub } = this.options;
    const before = registry.resolve(id);
    const key = before ? `${before.source}:${before.hash}:${before.manifest ? 1 : 0}` : null;
    const after = registry.rescanUser(id);
    const now = after ? `${after.source}:${after.hash}:${after.manifest ? 1 : 0}` : null;
    if (key === now) return;
    this.logger.info(
      { id, hash: after?.hash ?? null, valid: Boolean(after?.manifest) },
      "theme changed",
    );
    hub.publish(
      "theme.changed",
      after ? { id, hash: after.hash } : { id, hash: "", removed: true },
    );
  }

  private schedule(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        try {
          this.refresh(id);
        } catch (err) {
          this.logger.error({ err, id }, "theme rescan failed");
        }
      }, THEME_DEBOUNCE_MS),
    );
  }
}
