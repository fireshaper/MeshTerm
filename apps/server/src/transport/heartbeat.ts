import { systemClock, type Clock } from "../clock.js";
import type { Transport } from "./transport.js";

/**
 * Sends a `heartbeat` `ToRadio` every `intervalMs` while the transport is open, so
 * the firmware doesn't drop us as an idle API client (it does after 15 minutes).
 * Heartbeats are local to the node; they never go out over the mesh.
 */
export class Heartbeat {
  private cancel: (() => void) | null = null;
  private readonly onClose = () => {
    this.stop();
  };

  constructor(
    private readonly transport: Transport,
    private readonly intervalMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  get running(): boolean {
    return this.cancel !== null;
  }

  start(): void {
    if (this.cancel) return;
    this.transport.on("close", this.onClose);
    this.schedule();
  }

  stop(): void {
    if (!this.cancel) return;
    this.cancel();
    this.cancel = null;
    this.transport.off("close", this.onClose);
  }

  private schedule(): void {
    this.cancel = this.clock.setTimer(this.intervalMs, () => {
      if (!this.transport.isOpen) {
        this.stop();
        return;
      }
      this.transport.send({ payloadVariant: { case: "heartbeat", value: {} } });
      this.schedule();
    });
  }
}
