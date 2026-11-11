import { sleep } from "./sleep";
import { operationSignal } from "./interrupt";

export const withRetry = async <T>(
  fn: (attempt: number) => Promise<T> | T,
  params: {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    signal?: AbortSignal | undefined;
  }
): Promise<T> => {
  const { attempts, baseDelayMs, maxDelayMs } = params;
  const signal = operationSignal(params.signal);
  let lastError: unknown;
  const totalAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      if (attempt >= totalAttempts) {
        break;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
