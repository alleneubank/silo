import { appendGithubEnv } from "../core/env";
import { storedConfig } from "../core/allocation";
import { buildTiltCiArgv, tiltCi } from "../backends/tilt";
import { captureFinishedComposeProducers } from "../backends/ownership";
import { commandFailure } from "../core/owned_command";
import { resolveGithubEnvPath, shouldExportCiEnv, withCiEnv } from "../utils/ci";
import { prepareTiltEnvironment, withAllocation } from "./prepare";

export const ci = async (name: string | undefined, options: {
  config: string; force: boolean; profile: string | undefined; timeout: string | undefined;
  exportCi: boolean; tiltArgs: string[];
  executorEntrypoint?: string;
}): Promise<boolean> => {
  const sink = shouldExportCiEnv(options.exportCi) ? resolveGithubEnvPath(options.exportCi) : null;
  await withAllocation(name, options, async (owner, allocation) => {
    const config = storedConfig(allocation);
    const args = { timeout: options.timeout, extraArgs: options.tiltArgs, webMode: config.tilt?.webMode, managesPort: config.ports.TILT_PORT !== undefined };
    buildTiltCiArgv(args);
    const env = await prepareTiltEnvironment(owner);
    if (sink) appendGithubEnv(owner, sink);
    const result = await tiltCi(owner, withCiEnv(env), args);
    const failure = result.exitCode === 0 ? null : commandFailure(result, "tilt-ci", owner.generation);
    await captureFinishedComposeProducers(owner);
    owner.update(owner.current()!.allocation, failure ? "cleanup-required" : owner.resources().length > 0 ? "retained" : "stopped", failure?.message ?? null);
    if (failure) throw failure;
  }, config => { buildTiltCiArgv({ timeout: options.timeout, extraArgs: options.tiltArgs, webMode: config.tilt?.webMode, managesPort: config.ports.TILT_PORT !== undefined }); });
  return true;
};
