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
import { findTiltPidsInDir } from "../utils/process";
import { disownedPorts, findLiveDisowned, probeTilt } from "../core/liveness";
import { SiloError } from "../utils/errors";
import type { PortAllocationEvent } from "../core/ports";
import type { DisownedTilt, InstanceState, ResolvedConfig } from "../core/types";
import {
  REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS,
  REGISTRY_ADVERTISE_RETRY_COUNT,
  REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS,
  TILT_SUPERVISOR_BIN,
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
  baseConfig: ResolvedConfig;
  nameArg: string | undefined;
  options: PrepareOptions;
  // The live stack this run is replacing, decided by the caller. Its record is
  // written as part of the same lockfile write that hands ownership to the new
  // stack, so a failure before that write leaves the live stack owning it.
  disowning?: DisownedTilt | null;
}): Promise<PrepareResult> => {
  const { baseConfig, nameArg, options, disowning = null } = params;
  process.env.SILO_ACTIVE = "1";

  const lockfile = await readLockfile(baseConfig.projectRoot);
  const instance = lockfile?.instance;

  if (
    disowning === null &&
    instance?.tiltPid !== undefined &&
    (await probeTilt(instance.tiltPid))
  ) {
    throw new SiloError(
      `Instance '${instance.name}' already running. Use 'silo down' first.`,
      "ALREADY_RUNNING"
    );
  }

  // Stacks silo started are not "external", including ones a previous
  // `silo up --force` disowned — refusing on those would make --force
  // unusable a second time.
  const knownPids = new Set<number>([
    ...(instance?.tiltPid !== undefined ? [instance.tiltPid] : []),
    ...(instance?.disownedTilts ?? []).map((entry) => entry.pid),
    ...(disowning ? [disowning.pid] : []),
  ]);
  const externalTilt = await findTiltPidsInDir(baseConfig.projectRoot);
  const external = externalTilt.filter((pid) => !knownPids.has(pid));
  if (external.length > 0) {
    throw new SiloError("Tilt already running outside silo. Stop it first.", "TILT_RUNNING");
  }

  const { config, profileName } = resolveAndApplyProfile({
    baseConfig,
    profileFlag: options.profile,
    lockfile,
    force: options.force,
  });

  const tools = ["tilt", TILT_SUPERVISOR_BIN];
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

  // A disowned stack keeps serving on ports it may not have bound yet, and the
  // port registry only covers other project roots. Without this, a parallel
  // `--force` stack can probe one of those ports free and take it.
  const liveDisowned = [
    ...(await findLiveDisowned({ disowned: instance?.disownedTilts })),
    ...(disowning ? [disowning] : []),
  ];
  disownedPorts(liveDisowned).forEach((port) => excludedPorts.add(port));
  if (liveDisowned.length > 0) {
    logger.verbose(
      `Excluding port(s) owned by ${liveDisowned.length} disowned stack(s)`
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
      disownedTilts: liveDisowned,
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
  // The registry holds one entry per project root, so it must name every port
  // this project still owns — a disowned stack's included. Registering only the
  // new stack would let another project allocate a port the disowned one uses.
  const reservedPorts = (state: InstanceState): number[] => [
    ...Object.values(state.ports),
    ...disownedPorts(liveDisowned),
  ];

  await registerInstance({
    projectRoot: config.projectRoot,
    name: currentState.name,
    ports: reservedPorts(currentState),
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
          ports: reservedPorts(currentState),
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
