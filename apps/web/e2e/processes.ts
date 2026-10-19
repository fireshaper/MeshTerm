import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Repository root, from this file's location. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** A child process a spec starts and stops itself, with its output kept for error messages. */
export class ManagedProcess {
  private child: ChildProcess | null = null;
  private output = "";

  constructor(
    readonly name: string,
    private readonly args: string[],
    private readonly options: { cwd: string; env?: NodeJS.ProcessEnv },
  ) {}

  start(): void {
    if (this.child) throw new Error(`${this.name} is already running`);
    const child = spawn(process.execPath, this.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d: Buffer) => {
      this.append(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      this.append(d);
    });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
  }

  /** SIGTERM (a graceful shutdown on POSIX; a hard stop on Windows), then SIGKILL after 5 s. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => {
        resolve();
      }),
    );
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** The last few KB of output, for failure messages. */
  tail(): string {
    return `--- ${this.name} output ---\n${this.output.slice(-4_000)}`;
  }

  private append(chunk: Buffer): void {
    this.output = (this.output + chunk.toString()).slice(-20_000);
  }
}

/** Polls until `check` resolves true, or throws with `describe()` after the timeout. */
export async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  describe: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms\n${describe()}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
