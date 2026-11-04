import { ProjectOperation, processAbsent } from "../core/lease_store";
import { runningStackHintLines } from "../utils/breadcrumbs";
import { logger, logKeyValues } from "../utils/logger";
import { commandRoot } from "./prepare";
import { commandLiveness } from "../core/owned_command";

export const status = async (options: { config: string; json?: boolean; changed?: boolean }): Promise<void> => {
  const project = ProjectOperation.inspect(commandRoot(options.config));
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, legacy: false, changed: options.changed ?? false, project }));
    return;
  }
  if (!project?.allocation) { logger.info("No allocated instance. Run env or up to allocate."); return; }
  const allocation = project.allocation;
  logger.info(`Instance: ${allocation.state.name}`);
  logger.info(`Project: ${project.projectId}; generation: ${project.generation}`);
  logger.info(`State: ${project.phase}`);
  if (project.problem) logger.warn(project.problem);
  if (project.operation) logger.info(`Operation: ${project.operation.token}, pid ${project.operation.pid}`);
  for (const launch of project.launches) {
    const terminal = (launch.supervisorPid === null || processAbsent(launch.supervisorPid)) && (launch.groupId === null || processAbsent(-launch.groupId));
    logger.info(`Launch ${launch.id}: ${launch.kind}, ${launch.phase}; ${terminal ? "recorded groups absent" : "recorded group live or unknown"}`);
  }
  for (const resource of project.resources) logger.info(`Resource: ${resource.kind}/${resource.name} (${resource.id}), ${resource.createdAt}`);
  let tiltLive = false;
  for (const launch of project.launches.filter(l => l.kind === "tilt-up" && !l.terminal)) if (await commandLiveness(launch) === "live") tiltLive = true;
  runningStackHintLines({ tiltRunning: tiltLive, tiltPort: allocation.state.ports.TILT_PORT, urls: allocation.urls, kubeconfigPath: allocation.state.identity.kubeconfigPath }).forEach(line => logger.info(line));
  logKeyValues("Ports", allocation.state.ports);
  logKeyValues("URLs", allocation.urls);
  logger.info("Status is read-only; use down to reconcile this owner's resources. Process liveness is not application readiness.");
};
