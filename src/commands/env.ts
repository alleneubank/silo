import { loadConfig } from "../core/config";
import { buildInstanceState, resolveInstanceName } from "../core/instance";
import { appendGithubEnv, writeEnvAndLockfile } from "../core/env";
import { readLockfile } from "../core/lockfile";
import {
  readPeerPorts,
  registerInstance,
} from "../core/port_registry";
import { resolveAndApplyProfile } from "../core/profile";
import { logger, logPortAllocations } from "../utils/logger";
import { resolveGithubEnvPath, shouldExportCiEnv } from "../utils/ci";
import type { PortAllocationEvent } from "../core/ports";

export const env = async (
  nameArg: string | undefined,
  options: {
    config: string;
    force: boolean;
    profile: string | undefined;
    exportCi: boolean;
  }
) => {
  logger.info("Loading config");
  const baseConfig = await loadConfig(options.config);
  logger.verbose(`Config path: ${baseConfig.configPath}`);
  const lockfile = await readLockfile(baseConfig.projectRoot);

  const { config, profileName } = resolveAndApplyProfile({
    baseConfig,
    profileFlag: options.profile,
    lockfile,
    force: options.force,
  });

  const nameSource = nameArg
    ? "arg"
    : lockfile?.instance?.name
    ? "lockfile"
    : "generated";
  const name = resolveInstanceName({
    nameArg,
    lockfile,
    projectRoot: config.projectRoot,
  });
  logger.info(`Resolved instance name: ${name} (${nameSource})`);

  logger.info("Allocating ports");
  const excludedPorts = await readPeerPorts({
    excludeProjectRoot: config.projectRoot,
  });
  if (excludedPorts.size > 0) {
    logger.verbose(
      `Excluding ${excludedPorts.size} port(s) owned by peer silo instances`
    );
  }
  const portEvents: PortAllocationEvent[] = [];

  const { state, urls, hostOrder, portOrder, urlOrder } = await buildInstanceState({
    config,
    name,
    profile: profileName,
    lockfile,
    force: options.force,
    excludedPorts,
    onPortAllocation: (event) => portEvents.push(event),
  });

  logPortAllocations(portEvents);

  await writeEnvAndLockfile({ state, config, urls, hostOrder, portOrder, urlOrder });

  // Register AFTER the lockfile is on disk — registry liveness is tied to
  // `.silo.lock` presence, so a peer read between register() and lockfile
  // write would GC us and race-steal our ports. Order must stay:
  // allocate → write lockfile → register.
  await registerInstance({
    projectRoot: config.projectRoot,
    name: state.name,
    ports: Object.values(state.ports),
  });

  if (shouldExportCiEnv(options.exportCi)) {
    const githubEnvPath = resolveGithubEnvPath();
    await appendGithubEnv({ state, urls, githubEnvPath });
  }

  logger.info("Ports:");
  Object.entries(state.ports).forEach(([key, value]) => {
    logger.info(`  ${key}: ${value}`);
  });
  if (Object.keys(urls).length > 0) {
    logger.info("URLs:");
    Object.entries(urls).forEach(([key, value]) => {
      logger.info(`  ${key}: ${value}`);
    });
  }
};
