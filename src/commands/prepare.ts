import { loadConfig } from "../core/config";
import { buildInstanceState, resolveInstanceName } from "../core/instance";
import {
  buildEnvVars,
  buildSiloProcessEnv,
  resolveEnvPath,
  writeEnvAndLockfile,
} from "../core/env";
import { readLockfile, updateLockfile } from "../core/lockfile";
import {
  readPeerPorts,
  registerInstance,
} from "../core/port_registry";
import { resolveAndApplyProfile } from "../core/profile";
import {
  applyRegistryPortOverride,
  resolveRegistryAdvertiseSettings,
} from "../core/registry";
import { ensureToolsAvailable } from "../utils/validate";
import { logger, logPortAllocations } from "../utils/logger";
import { runHooks } from "../hooks/runner";
import { ensureCluster, writeKubeconfig } from "../backends/k3d";
import { advertiseLocalRegistry } from "../backends/registry";
import { resolveRegistryHostPort } from "../backends/registry-port";
import { findTiltPidsInDir, isPidRunning, isTiltProcess } from "../utils/process";
import { SiloError } from "../utils/errors";
import type { PortAllocationEvent } from "../core/ports";
import type { InstanceState, ResolvedConfig } from "../core/types";
import {
  REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS,
  REGISTRY_ADVERTISE_RETRY_COUNT,
  REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS,
} from "../core/constants";

type PrepareResult = {
  config: ResolvedConfig;
  state: InstanceState;
  urls: Record<string, string>;
  envVars: Record<string, string>;
};

type PrepareOptions = {
  config: string;
  force: boolean;
  profile: string | undefined;
};

export const prepareTiltEnvironment = async (params: {
  nameArg: string | undefined;
  options: PrepareOptions;
}): Promise<PrepareResult> => {
  const { nameArg, options } = params;
  process.env.SILO_ACTIVE = "1";

  logger.info("Loading config");
  const baseConfig = await loadConfig(options.config);
  logger.verbose(`Config path: ${baseConfig.configPath}`);

  const lockfile = await readLockfile(baseConfig.projectRoot);

  if (lockfile?.instance?.tiltPid && isPidRunning(lockfile.instance.tiltPid)) {
    const isTilt = await isTiltProcess(lockfile.instance.tiltPid);
    if (isTilt) {
      throw new SiloError(
        `Instance '${lockfile.instance.name}' already running. Use 'silo down' first.`,
        "ALREADY_RUNNING"
      );
    }
  }

  const externalTilt = await findTiltPidsInDir(baseConfig.projectRoot);
  const trackedPid = lockfile?.instance?.tiltPid;
  const external = externalTilt.filter((pid) => pid !== trackedPid);
  if (external.length > 0) {
    throw new SiloError("Tilt already running outside silo. Stop it first.", "TILT_RUNNING");
  }

  const { config, profileName } = resolveAndApplyProfile({
    baseConfig,
    profileFlag: options.profile,
    lockfile,
    force: options.force,
  });

  const tools = ["tilt"];
  if (config.k3d?.enabled) {
    tools.push("k3d");
  }
  const registryAdvertiseEnabled =
    (config.k3d?.registry?.enabled && config.k3d.registry.advertise !== false) ||
    (config.registry && config.registry.advertise !== false);
  if (config.k3d?.registry?.enabled) {
    tools.push("docker");
  }
  if (registryAdvertiseEnabled) {
    tools.push("kubectl");
  }
  logger.info(`Validating tools: ${tools.join(", ")}`);
  await ensureToolsAvailable(tools);

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
  const { state, urls, envVars: baseEnvVars, hostOrder, portOrder, urlOrder, k3dArgs } =
    await buildInstanceState({
      config,
      name,
      profile: profileName,
      lockfile,
      force: options.force,
      excludedPorts,
      onPortAllocation: (event) => portEvents.push(event),
    });

  logPortAllocations(portEvents);

  const envFilePath = resolveEnvPath(config);
  const siloEnv = buildSiloProcessEnv({ state, envFilePath });
  const envVars = { ...baseEnvVars, ...siloEnv };
  Object.assign(process.env, siloEnv);

  let currentState = state;
  let currentUrls = urls;
  let currentEnvVars = envVars;

  await writeEnvAndLockfile({
    state: currentState,
    config,
    urls: currentUrls,
    hostOrder,
    portOrder,
    urlOrder,
  });

  // Register AFTER the lockfile is on disk. Registry liveness is keyed on
  // `.silo.lock` presence, so registering before the lockfile exists would
  // let a concurrent peer read GC our entry immediately and steal our
  // ports. Order must be: allocate → write lockfile → register.
  await registerInstance({
    projectRoot: config.projectRoot,
    name: currentState.name,
    ports: Object.values(currentState.ports),
  });

  logger.info(`Running pre-up hooks (${config.hooks["pre-up"]?.length ?? 0})`);
  await runHooks({
    hooks: config.hooks["pre-up"],
    env: currentEnvVars,
    cwd: config.projectRoot,
    phase: "pre-up",
  });

  if (config.k3d?.enabled && currentState.identity.k3dClusterName) {
    const registryName = currentState.identity.k3dRegistryName;
    logger.info(`Ensuring k3d cluster '${currentState.identity.k3dClusterName}'`);
    const { created } = await ensureCluster({
      clusterName: currentState.identity.k3dClusterName,
      registryName,
      args: k3dArgs,
      cwd: config.projectRoot,
    });

    currentState = { ...currentState, k3dClusterCreated: true };

    if (currentState.identity.kubeconfigPath) {
      logger.info("Writing kubeconfig");
      await writeKubeconfig(
        currentState.identity.k3dClusterName!,
        currentState.identity.kubeconfigPath,
        config.projectRoot
      );
    }

    if (config.k3d?.registry?.enabled && registryName) {
      const actualPort = await resolveRegistryHostPort({
        registryName,
        cwd: config.projectRoot,
      });
      const { changed, state: reconciledState, urls: reconciledUrls } =
        applyRegistryPortOverride({
          state: currentState,
          config,
          actualPort,
        });
      if (changed) {
        const previousPort = currentState.ports.K3D_REGISTRY_PORT;
        logger.warn(
          `Registry port drift detected (requested ${previousPort}, actual ${actualPort}). Updating lockfile.`
        );
        currentState = reconciledState;
        currentUrls = reconciledUrls;
        currentEnvVars = { ...buildEnvVars(currentState, currentUrls), ...siloEnv };
        await writeEnvAndLockfile({
          state: currentState,
          config,
          urls: currentUrls,
          hostOrder,
          portOrder,
          urlOrder,
        });
        // K3D_REGISTRY_PORT drifted — refresh the registry entry so peer
        // instances see the actually-bound port rather than the originally
        // allocated one.
        await registerInstance({
          projectRoot: config.projectRoot,
          name: currentState.name,
          ports: Object.values(currentState.ports),
        });
      }
    }

    await updateLockfile(config.projectRoot, (current) => ({
      ...current.instance,
      k3dClusterCreated: true,
    }));

    logger.info(
      created
        ? `Created k3d cluster '${currentState.identity.k3dClusterName}'`
        : `Reusing k3d cluster '${currentState.identity.k3dClusterName}'`
    );
  }

  const advertiseSettings = resolveRegistryAdvertiseSettings({
    config,
    state: currentState,
    urls: currentUrls,
  });
  if (advertiseSettings) {
    if (!currentState.identity.kubeconfigPath && advertiseSettings.source === "k3d") {
      throw new SiloError(
        "Kubeconfig path missing for registry advertisement",
        "INVALID_STATE"
      );
    }
    logger.info("Advertising registry via ConfigMap");
    await advertiseLocalRegistry({
      registryHost: advertiseSettings.host,
      ...(advertiseSettings.hostFromContainerRuntime !== undefined && {
        registryHostFromContainerRuntime: advertiseSettings.hostFromContainerRuntime,
      }),
      ...(advertiseSettings.hostFromClusterNetwork !== undefined && {
        registryHostFromClusterNetwork: advertiseSettings.hostFromClusterNetwork,
      }),
      ...(advertiseSettings.help !== undefined && { help: advertiseSettings.help }),
      ...(currentState.identity.kubeconfigPath !== undefined && {
        kubeconfigPath: currentState.identity.kubeconfigPath,
      }),
      cwd: config.projectRoot,
      retry: {
        attempts: REGISTRY_ADVERTISE_RETRY_COUNT,
        baseDelayMs: REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS,
        maxDelayMs: REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS,
      },
    });
  }

  logger.info(`Running post-up hooks (${config.hooks["post-up"]?.length ?? 0})`);
  await runHooks({
    hooks: config.hooks["post-up"],
    env: currentEnvVars,
    cwd: config.projectRoot,
    phase: "post-up",
  });

  return {
    config,
    state: currentState,
    urls: currentUrls,
    envVars: currentEnvVars,
  };
};
