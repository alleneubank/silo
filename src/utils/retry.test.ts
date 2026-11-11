import { expect, test } from "bun:test";
import { withRetry } from "./retry";
import { interruption } from "./interrupt";

for (const when of ["command", "backoff"] as const) {
  test(`cancelling retry during ${when} preserves the interruption and starts no more attempts`, async () => {
    const controller = new AbortController();
    const reason = interruption("up", "SIGINT");
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = withRetry(() => {
      attempts++;
      if (when === "command") controller.abort(reason);
      else timer = setTimeout(() => controller.abort(reason), 0);
      throw new Error("transient dependency failure");
    }, { attempts: 5, baseDelayMs: 60_000, maxDelayMs: 60_000, signal: controller.signal });
    try {
      await expect(result).rejects.toBe(reason);
      expect(attempts).toBe(1);
    } finally { clearTimeout(timer); }
  }, 2000);
}
