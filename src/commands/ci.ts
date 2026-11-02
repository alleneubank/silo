import { loadConfig } from "../core/config";
import { appendGithubEnv } from "../core/env";
import { logger } from "../utils/logger";
import { buildTiltCiArgv, tiltCi } from "../backends/tilt";
import { resolveAndApplyProfile } from "../core/profile";
import { readLockfile } from "../core/lockfile";
import { resolveGithubEnvPath, shouldExportCiEnv, withCiEnv } from "../utils/ci";
import { prepareTiltEnvironment } from "./prepare";

export const ci = async (
  nameArg: string | undefined,
  options: {
    config: string;
    force: boolean;
    profile: string | undefined;
    timeout: string | undefined;
    exportCi: boolean;
    tiltArgs: string[];
  }
): Promise<void> => {
  logger.info("Loading config");
  const baseConfig = await loadConfig(options.config);
  logger.verbose(`Config path: ${baseConfig.configPath}`);

  // Refuse conflicting passthrough before allocation, hooks or cluster effects.
  const { config: launchConfig } = resolveAndApplyProfile({
    baseConfig,
    profileFlag: options.profile,
    lockfile: await readLockfile(baseConfig.projectRoot),
    force: options.force,
  });
  buildTiltCiArgv({ timeout: options.timeout, extraArgs: options.tiltArgs, webMode: launchConfig.tilt?.webMode });

  const { config, state, urls, envVars } = await prepareTiltEnvironment({
    baseConfig,
    nameArg,
    options,
  });

  if (shouldExportCiEnv(options.exportCi)) {
    const githubEnvPath = resolveGithubEnvPath(options.exportCi);
    if (githubEnvPath) {
      await appendGithubEnv({
        state,
        urls,
        githubEnvPath,
      });
    } else {
      logger.warn("GITHUB_ENV is not set; skipping CI env export");
    }
  }

  logger.info("Running tilt ci");
  await tiltCi({
    cwd: config.projectRoot,
    env: withCiEnv(envVars),
    timeout: options.timeout,
    extraArgs: options.tiltArgs,
    webMode: config.tilt?.webMode,
  });
};
