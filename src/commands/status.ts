import path from "path";
import { loadConfig } from "../core/config";
import { readLockfile } from "../core/lockfile";
import { resolveInstanceUrls } from "../core/instance";
import { applyProfile } from "../core/profile";
import { clusterExists } from "../backends/k3d";
import { findLiveDisowned, probeTilt } from "../core/liveness";
import { logKeyValues, logger } from "../utils/logger";
import { resolveRegistryAdvertiseSettings } from "../core/registry";
import { getRegistryConfigMapStatus } from "../backends/registry";

export const status = async (options: { config: string }): Promise<void> => {
  const resolvedConfigPath = path.resolve(process.cwd(), options.config);
  const configFile = Bun.file(resolvedConfigPath);
  const hasConfig = await configFile.exists();
  const config = hasConfig ? await loadConfig(options.config) : null;
  if (config) {
    logger.verbose(`Config path: ${config.configPath}`);
  }
  const projectRoot = config?.projectRoot ?? process.cwd();

  const lockfile = await readLockfile(projectRoot);
  if (!lockfile) {
    logger.info("No active instance. Run 'silo up' to start.");
    return;
  }

  const profileName = lockfile.instance.profile;
  const resolvedConfig =
    config && profileName ? applyProfile(config, profileName) : config;

  const tiltPid = lockfile.instance.tiltPid;
  const tiltRunning = tiltPid !== undefined ? await probeTilt(tiltPid) : false;
  const liveDisowned = await findLiveDisowned({
    disowned: lockfile.instance.disownedTilts,
  });

  const clusterName = lockfile.instance.identity.k3dClusterName;
  const k3dRunning = clusterName
    ? await clusterExists(clusterName, projectRoot)
    : false;

  logger.info(`Instance: ${lockfile.instance.name}`);
  if (profileName) {
    logger.info(`Profile: ${profileName}`);
  }
  logger.info(`State: ${tiltRunning ? "running" : "stopped"}`);
  if (tiltPid) {
    logger.info(`Tilt: ${tiltRunning ? `pid ${tiltPid}` : "not running"}`);
  }
  if (liveDisowned.length > 0) {
    // Stacks a `silo up --force` left running. They answer on their own ports
    // and 'silo down' does not stop them, so naming them is the only way to
    // tell which Tilt owns which port.
    logger.warn(`Disowned stacks still running: ${liveDisowned.length}`);
    liveDisowned.forEach((entry) => {
      const ports = Object.values(entry.ports).join(", ");
      logger.warn(
        `  pid ${entry.pid} (instance '${entry.name}', disowned ${entry.disownedAt}, ports ${ports})`
      );
    });
    logger.warn("Stop a disowned stack with 'kill <pid>'.");
  }
  if (clusterName) {
    logger.info(`k3d: ${clusterName} (${k3dRunning ? "running" : "missing"})`);
  }
  const urls = resolveInstanceUrls({
    config: resolvedConfig,
    instance: lockfile.instance,
  });

  const registrySettings = resolvedConfig
    ? resolveRegistryAdvertiseSettings({
        config: resolvedConfig,
        state: lockfile.instance,
        urls,
      })
    : null;

  if (lockfile.instance.identity.k3dRegistryName) {
    const registryHost = registrySettings?.host;
    const hostLabel = registryHost ? ` (host ${registryHost})` : "";
    logger.info(`Registry: ${lockfile.instance.identity.k3dRegistryName}${hostLabel}`);
  } else if (registrySettings) {
    logger.info(`Registry: ${registrySettings.host} (external)`);
  }
  if (lockfile.instance.identity.kubeconfigPath) {
    logger.info(`Kubeconfig: ${lockfile.instance.identity.kubeconfigPath}`);
  }

  logKeyValues("Ports", lockfile.instance.ports);

  if (registrySettings) {
    const registryStatus = await getRegistryConfigMapStatus({
      ...(lockfile.instance.identity.kubeconfigPath !== undefined && {
        kubeconfigPath: lockfile.instance.identity.kubeconfigPath,
      }),
      cwd: projectRoot,
    });
    logger.info(`Registry ConfigMap: ${registryStatus}`);
  }

  logKeyValues("URLs", urls);
};
