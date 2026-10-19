/** The subset of Pino's logger the server uses, so modules don't depend on Pino directly. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface LogEntry {
  level: keyof Logger;
  obj: object;
  msg: string | undefined;
}

/** Keeps every entry in memory; for tests. */
export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  debug(obj: object, msg?: string): void {
    this.entries.push({ level: "debug", obj, msg });
  }
  info(obj: object, msg?: string): void {
    this.entries.push({ level: "info", obj, msg });
  }
  warn(obj: object, msg?: string): void {
    this.entries.push({ level: "warn", obj, msg });
  }
  error(obj: object, msg?: string): void {
    this.entries.push({ level: "error", obj, msg });
  }
}
