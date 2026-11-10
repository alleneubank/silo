import { SiloError } from "./errors";

/** A wait carries the action that releases its resources when it loses. */
export type Cancellable<T> = {
  result: Promise<T>;
  cancel: () => void | Promise<void>;
};

/** Every loser is released before the caller can act on the winner. */
export async function raceOperations<T>(operations: readonly [Cancellable<T>, ...Cancellable<T>[]]): Promise<T> {
  let winner = -1;
  const [outcome] = await Promise.allSettled([Promise.race(operations.map(async (operation, index) => {
    const value = await operation.result;
    if (winner === -1) winner = index;
    return value;
  }))]);
  const releases = await Promise.allSettled(operations.map(async (operation, index) => {
    if (index !== winner) await operation.cancel();
  }));
  const failures = releases.filter(result => result.status === "rejected").map(result => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to release asynchronous operations", outcome.status === "rejected" ? { cause: outcome.reason } : {});
  }
  if (outcome.status === "rejected") throw outcome.reason;
  return outcome.value;
}

/** Cancels a subscription, without taking ownership of the observed work. */
export const observe = <T>(promise: Promise<T>): Cancellable<T> => {
  let subscriber: { resolve: (value: T) => void; reject: (error: unknown) => void } | undefined;
  const result = new Promise<T>((resolve, reject) => { subscriber = { resolve, reject }; });
  void promise.then(value => { subscriber?.resolve(value); subscriber = undefined; }, error => { subscriber?.reject(error); subscriber = undefined; });
  return { result, cancel: () => { subscriber = undefined; } };
};

export async function withTimeout<T>(
  operation: Cancellable<T>,
  timeoutMs: number,
  context: string,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new SiloError(`Timed out after ${timeoutMs}ms: ${context}`, "TIMEOUT")), timeoutMs);
  });
  const waits: [Cancellable<T>, ...Cancellable<T>[]] = [operation, { result, cancel: () => clearTimeout(timer) }];
  if (signal) {
    const abort = () => rejectAbort(signal.reason);
    let rejectAbort: (reason: unknown) => void;
    const result = new Promise<never>((_, reject) => { rejectAbort = reject; });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    waits.push({ result, cancel: () => signal.removeEventListener("abort", abort) });
  }
  return raceOperations(waits);
}
