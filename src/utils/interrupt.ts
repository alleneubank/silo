import { SiloError } from "./errors";

export type InterruptSignal = "SIGINT" | "SIGTERM";

export const interruption = (command: string, signal: InterruptSignal): SiloError => new SiloError(
  `${command} interrupted by ${signal}; owned claims retained. Run silo status and silo down to reconcile.`,
  "INTERRUPTED", { details: { signal } },
);

/** One signal owner spans preparation, owned commands and reconciliation. */
export class OperationInterrupts {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly onInt = () => this.interrupt("SIGINT");
  private readonly onTerm = () => this.interrupt("SIGTERM");

  constructor(private readonly command: string) {
    process.on("SIGINT", this.onInt);
    process.on("SIGTERM", this.onTerm);
  }

  private interrupt(signal: InterruptSignal): void {
    if (!this.signal.aborted) this.controller.abort(interruption(this.command, signal));
  }

  close(): void {
    process.off("SIGINT", this.onInt);
    process.off("SIGTERM", this.onTerm);
  }
}
