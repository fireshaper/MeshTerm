import { connect, type Socket } from "node:net";
import {
  decodeFromRadio,
  encodeFrame,
  encodeToRadio,
  type FromRadio,
  StreamFramer,
  type ToRadioInit,
} from "@meshterm/protocol";

/** Minimal raw-socket client for tests: writes framed `ToRadio`, collects decoded `FromRadio`. */
export class RawClient {
  readonly received: FromRadio[] = [];
  private readonly waiters: (() => void)[] = [];

  private constructor(readonly socket: Socket) {
    const framer = new StreamFramer();
    socket.on("data", (chunk) => {
      for (const payload of framer.push(chunk)) this.received.push(decodeFromRadio(payload));
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static open(port: number, host = "127.0.0.1"): Promise<RawClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, host);
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.off("error", reject);
        socket.setNoDelay(true);
        resolve(new RawClient(socket));
      });
    });
  }

  send(init: ToRadioInit): void {
    this.socket.write(encodeFrame(encodeToRadio(init)));
  }

  /** Writes raw bytes, e.g. a frame split across several writes. */
  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(bytes, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Resolves once `predicate` holds over everything received so far. */
  async waitFor(predicate: (received: FromRadio[]) => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.received)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`RawClient.waitFor timed out after ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.socket.destroy();
  }
}

/** Polls `predicate` until it holds; for checking server-side state from tests. */
export async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`until() timed out after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
