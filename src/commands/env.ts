import { loadConfig } from "../core/config";
import { buildInstanceState, resolveInstanceName } from "../core/instance";
import { appendGithubEnv, resolveEnvPath, writeEnvAndLockfile } from "../core/env";
import { readLockfile } from "../core/lockfile";
import {
  readPeerPorts,
  registerInstance,
} from "../core/port_registry";
import { resolveAndApplyProfile } from "../core/profile";
import { disownedPorts, findLiveDisowned } from "../core/liveness";
import { logKeyValues, logger, logPortAllocations } from "../utils/logger";
import { envDidNotStartHint } from "../utils/breadcrumbs";
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

  // Stacks a previous `silo up --force` left running still answer on their
  // ports, and the registry entry this command rewrites is what keeps other
  // projects off them.
  const liveDisowned = await findLiveDisowned({
    disowned: lockfile?.instance.disownedTilts,
  });
  disownedPorts(liveDisowned).forEach((port) => excludedPorts.add(port));

  const portEvents: PortAllocationEvent[] = [];

  const { state, urls, hostOrder, portOrder, urlOrder } = await buildInstanceState({
    config,
    name,
    profile: profileName,
    lockfile,
    force: options.force,
    excludedPorts,
    disownedTilts: liveDisowned,
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
    ports: [...Object.values(state.ports), ...disownedPorts(liveDisowned)],
  });

  logKeyValues("Ports", state.ports);
  logKeyValues("URLs", urls);
  logger.info(envDidNotStartHint(resolveEnvPath(config)));

  if (shouldExportCiEnv(options.exportCi)) {
    const githubEnvPath = resolveGithubEnvPath(options.exportCi);
    if (githubEnvPath) {
      await appendGithubEnv({ state, urls, githubEnvPath });
    } else {
      logger.warn("GITHUB_ENV is not set; skipping CI env export");
    }
  }
};
