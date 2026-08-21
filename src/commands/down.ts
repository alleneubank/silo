import { loadConfig } from "../core/config";
import { buildSiloProcessEnv, resolveEnvPath } from "../core/env";
import { readLockfile, updateLockfile } from "../core/lockfile";
import { unregisterInstance } from "../core/port_registry";
import { applyProfile } from "../core/profile";
import { logger } from "../utils/logger";
import { promises as fs } from "fs";
import { runHooks } from "../hooks/runner";
import { deleteCluster } from "../backends/k3d";
import { tiltDown } from "../backends/tilt";
import { buildTemplateVars } from "../core/variables";
import { resolveTemplateRecord } from "../core/instance";
import { buildEnvVars } from "../core/env";
import { stopProcess } from "../utils/process";
import {
  describeDisownedStacks,
  findLiveDisowned,
  probeTilt,
} from "../core/liveness";
import { SiloError } from "../utils/errors";
import { ensureToolsAvailable } from "../utils/validate";

export const down = async (options: {
  config: string;
  "delete-cluster": boolean;
  clean: boolean;
}): Promise<void> => {
  process.env.SILO_ACTIVE = "1";

  logger.info("Loading config");
  const baseConfig = await loadConfig(options.config);
  logger.verbose(`Config path: ${baseConfig.configPath}`);
  const lockfile = await readLockfile(baseConfig.projectRoot);
  if (!lockfile) {
    throw new SiloError("No lockfile found. Nothing to stop.", "LOCKFILE_MISSING");
  }

  const profileName = lockfile.instance.profile;
  const config = profileName ? applyProfile(baseConfig, profileName) : baseConfig;

  const templateVars = buildTemplateVars({
    identity: lockfile.instance.identity,
    ports: lockfile.instance.ports,
  });
  const urls = resolveTemplateRecord(config.urls, config.urlOrder, templateVars);
  const envFilePath = resolveEnvPath(config);
  const siloEnv = buildSiloProcessEnv({ state: lockfile.instance, envFilePath });
  const envVars = { ...buildEnvVars(lockfile.instance, urls), ...siloEnv };
  Object.assign(process.env, siloEnv);

  const liveDisowned = await findLiveDisowned({
    disowned: lockfile.instance.disownedTilts,
  });
  if (liveDisowned.length > 0) {
    // Refuse before anything is torn down: --clean removes the lockfile and
    // releases the project's port reservations, which are the only record that
    // these stacks exist and the only thing keeping peers off their ports.
    if (options.clean) {
      throw new SiloError(
        `--clean would erase the only record of ${liveDisowned.length} running stack(s): ` +
          `${describeDisownedStacks(liveDisowned)}. Stop them with 'kill <pid>' first.`,
        "DISOWNED_RUNNING"
      );
    }

    logger.warn(
      `${liveDisowned.length} stack(s) disowned by 'silo up --force' are still running; 'silo down' does not stop them.`
    );
    liveDisowned.forEach((entry) => {
      logger.warn(`  pid ${entry.pid} (instance '${entry.name}')`);
    });
    logger.warn(
      "Stop them with 'kill <pid>'. 'tilt down' below tears down resources they may share."
    );
  }

  logger.info(`Running pre-down hooks (${config.hooks["pre-down"]?.length ?? 0})`);
  await runHooks({
    hooks: config.hooks["pre-down"],
    env: envVars,
    cwd: config.projectRoot,
    phase: "pre-down",
  });

  try {
    await ensureToolsAvailable(["tilt"]);
    logger.info("Running tilt down");
    await tiltDown({ cwd: config.projectRoot, env: envVars });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`tilt down failed: ${message}`);
  }

  const tiltPid = lockfile.instance.tiltPid;
  if (tiltPid !== undefined && (await probeTilt(tiltPid))) {
    logger.info(`Stopping Tilt (pid ${tiltPid})`);
    await stopProcess(tiltPid);
    logger.info("Stopped Tilt");
  }

  // Drop the stopped pid, and any disowned stack that has since exited, so the
  // lockfile only ever names processes that are actually running.
  const recordedDisowned = lockfile.instance.disownedTilts?.length ?? 0;
  if (
    lockfile.instance.tiltPid ||
    lockfile.instance.tiltStartedAt ||
    recordedDisowned !== liveDisowned.length
  ) {
    await updateLockfile(config.projectRoot, (current) => {
      const {
        tiltPid: _tiltPid,
        tiltStartedAt: _tiltStartedAt,
        disownedTilts: _disownedTilts,
        ...rest
      } = current.instance;
      return {
        ...rest,
        ...(liveDisowned.length > 0 ? { disownedTilts: liveDisowned } : {}),
      };
    });
  }

  if (options["delete-cluster"] && lockfile.instance.identity.k3dClusterName) {
    logger.info(`Deleting k3d cluster '${lockfile.instance.identity.k3dClusterName}'`);
    await deleteCluster(lockfile.instance.identity.k3dClusterName, config.projectRoot);
    await updateLockfile(config.projectRoot, (current) => ({
      ...current.instance,
      k3dClusterCreated: false,
    }));
  }

  try {
    logger.info(`Running post-down hooks (${config.hooks["post-down"]?.length ?? 0})`);
    await runHooks({
      hooks: config.hooks["post-down"],
      env: envVars,
      cwd: config.projectRoot,
      phase: "post-down",
    });
  } catch (error) {
    logger.warn(`post-down hook failed: ${(error as Error).message}`);
  }

  if (options.clean) {
    logger.info("Removing env file and lockfile");
    await fs.rm(envFilePath, { force: true });
    await fs.rm(`${config.projectRoot}/.silo.lock`, { force: true });
    // Release this instance's ports in the machine-wide registry so peer
    // silo instances can claim them. When --clean is not passed, the entry
    // stays so peer allocations continue to avoid these ports until the
    // lockfile is removed.
    await unregisterInstance({ projectRoot: config.projectRoot });
  }
};
