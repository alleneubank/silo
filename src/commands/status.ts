import path from "path";
import { loadConfig } from "../core/config";
import { readLockfile } from "../core/lockfile";
import { buildTemplateVars } from "../core/variables";
import { resolveTemplateRecord } from "../core/instance";
import { applyProfile } from "../core/profile";
import { clusterExists } from "../backends/k3d";
import { isPidRunning, isTrackedTiltProcess } from "../utils/process";
import { logger } from "../utils/logger";
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
  const tiltRunning = tiltPid
    ? isPidRunning(tiltPid) && (await isTrackedTiltProcess(tiltPid))
    : false;

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
  if (clusterName) {
    logger.info(`k3d: ${clusterName} (${k3dRunning ? "running" : "missing"})`);
  }
  const urls =
    resolvedConfig && resolvedConfig.urlOrder.length > 0
      ? resolveTemplateRecord(
          resolvedConfig.urls,
          resolvedConfig.urlOrder,
          buildTemplateVars({
            identity: lockfile.instance.identity,
            ports: lockfile.instance.ports,
          })
        )
      : {};

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

  logger.info("Ports:");
  Object.entries(lockfile.instance.ports).forEach(([key, value]) => {
    logger.info(`  ${key}: ${value}`);
  });

  if (registrySettings) {
    const registryStatus = await getRegistryConfigMapStatus({
      ...(lockfile.instance.identity.kubeconfigPath !== undefined && {
        kubeconfigPath: lockfile.instance.identity.kubeconfigPath,
      }),
      cwd: projectRoot,
    });
    logger.info(`Registry ConfigMap: ${registryStatus}`);
  }

  if (resolvedConfig && resolvedConfig.urlOrder.length > 0) {
    logger.info("URLs:");
    Object.entries(urls).forEach(([key, value]) => {
      logger.info(`  ${key}: ${value}`);
    });
  }
};
