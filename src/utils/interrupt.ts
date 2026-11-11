import { SiloError } from "./errors";
import { AsyncLocalStorage } from "node:async_hooks";

export type InterruptSignal = "SIGINT" | "SIGTERM";

type InterruptionTarget = {
  storePath: string;
  projectId: string;
  generation: () => number;
  revision: () => string;
  record: (error: unknown) => void;
};

export const interruption = (command: string, signal: InterruptSignal): SiloError => new SiloError(
  `${command} interrupted by ${signal}; owned claims retained. Run silo status and silo down to reconcile.`,
  "INTERRUPTED", { details: { signal } },
);

/** One signal owner spans preparation, owned commands and reconciliation. */
export class OperationInterrupts {
  private static readonly scope = new AsyncLocalStorage<OperationInterrupts>();
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private target: InterruptionTarget | undefined;
  private recordFailure: unknown;
  private readonly onInt = () => this.interrupt("SIGINT");
  private readonly onTerm = () => this.interrupt("SIGTERM");

  constructor(private readonly command: string) {
    process.on("SIGINT", this.onInt);
    process.on("SIGTERM", this.onTerm);
  }

  static current(): OperationInterrupts | undefined { return this.scope.getStore(); }

  async run<T>(work: () => Promise<T>): Promise<T> {
    return OperationInterrupts.scope.run(this, async () => {
      this.throwIfAborted();
      try { return await work(); }
      finally {
        if (this.recordFailure !== undefined) this.throwIfAborted();
      }
    });
  }

  /** Reopens may refresh the recorder, but cannot retarget a command to a peer's generation. */
  recordWith(target: InterruptionTarget): void {
    const current = this.target;
    if (current && (current.storePath !== target.storePath || current.projectId !== target.projectId || current.generation() !== target.generation() || current.revision() !== target.revision())) return;
    this.target = target;
    if (this.signal.aborted) this.recordInterruption();
  }

  private recordInterruption(): void {
    try { this.target?.record(this.signal.reason); }
    catch (error) { this.recordFailure = error; }
  }

  throwIfAborted(): void {
    if (this.recordFailure !== undefined) throw new AggregateError([this.signal.reason, this.recordFailure], "Interrupted operation could not record its problem");
    this.signal.throwIfAborted();
  }

  private interrupt(signal: InterruptSignal): void {
    if (this.signal.aborted) return;
    this.controller.abort(interruption(this.command, signal));
    this.recordInterruption();
  }

  close(): void {
    process.off("SIGINT", this.onInt);
    process.off("SIGTERM", this.onTerm);
  }
}

/** Internal deadlines may narrow the ambient operation, never replace it. */
export const operationSignal = (local?: AbortSignal): AbortSignal | undefined => {
  const ambient = OperationInterrupts.current()?.signal;
  if (!ambient || ambient === local) return local ?? ambient;
  return local ? AbortSignal.any([ambient, local]) : ambient;
};
