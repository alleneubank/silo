import { loadConfig } from "../core/config";
import { appendGithubEnv } from "../core/env";
import { logger } from "../utils/logger";
import { tiltCi } from "../backends/tilt";
import { resolveGithubEnvPath, shouldExportCiEnv } from "../utils/ci";
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

  const { config, state, urls, envVars } = await prepareTiltEnvironment({
    baseConfig,
    nameArg,
    options,
  });

  if (shouldExportCiEnv(options.exportCi)) {
    const githubEnvPath = resolveGithubEnvPath();
    await appendGithubEnv({
      state,
      urls,
      githubEnvPath,
    });
  }

  logger.info("Running tilt ci");
  await tiltCi({
    cwd: config.projectRoot,
    env: envVars,
    timeout: options.timeout,
    extraArgs: options.tiltArgs,
  });
};
