import { sleep } from "./sleep";

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
  let lastError: unknown;
  const totalAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    params.signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      params.signal?.throwIfAborted();
      lastError = error;
      if (attempt >= totalAttempts) {
        break;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay, params.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
