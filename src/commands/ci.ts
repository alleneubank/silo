import { appendGithubEnv } from "../core/env";
import { storedConfig } from "../core/allocation";
import { buildTiltCiArgv, tiltCi } from "../backends/tilt";
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
    await tiltCi(owner, withCiEnv(env), args);
    owner.update(owner.current()!.allocation, owner.resources().length > 0 ? "retained" : "stopped");
  }, config => { buildTiltCiArgv({ timeout: options.timeout, extraArgs: options.tiltArgs, webMode: config.tilt?.webMode, managesPort: config.ports.TILT_PORT !== undefined }); });
  return true;
};
