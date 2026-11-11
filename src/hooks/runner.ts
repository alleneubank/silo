import { HOOK_TIMEOUT_MS } from "../core/constants";
import { runProducerCommand } from "../backends/ownership";
import type { ProjectOperation } from "../core/lease_store";

export const runHooks = async (owner: ProjectOperation, params: {
  hooks: string[] | undefined;
  env: Record<string, string>;
  phase: string;
}): Promise<void> => {
  const { hooks, env, phase } = params;
  if (!hooks || hooks.length === 0) {
    return;
  }

  for (const hook of hooks) {
    await runProducerCommand(owner, ["/bin/sh", "-c", hook], {
      env,
      timeoutMs: HOOK_TIMEOUT_MS,
      kind: `hook-${phase}`,
      effect: "hook",
    });
  }
};
