import { ProjectOperation, processAbsent } from "../core/lease_store";
import type { ExecutorCompletion, Launch } from "../core/lease_types";
import { runningStackHintLines } from "../utils/breadcrumbs";
import { logger, logKeyValues } from "../utils/logger";
import { commandRoot } from "./prepare";
import { commandLiveness } from "../core/owned_command";
import { SiloError } from "../utils/errors";

type LaunchStatus = {
  launchId: string;
  state: "unconfirmed" | "completed" | "resolved" | "terminated" | "live-or-unknown";
  groupsAbsent: boolean;
  completion: ExecutorCompletion | null;
};

export const observedLaunch = (launch: Launch, completion: ExecutorCompletion | null): LaunchStatus => {
  const groupsAbsent = launch.supervisorPid !== null && processAbsent(launch.supervisorPid) && processAbsent(-launch.groupId);
  let state: LaunchStatus["state"];
  if (launch.phase === "planned" || launch.phase === "cancelled") state = "unconfirmed";
  else if (launch.phase === "resolved") state = "resolved";
  else if (launch.phase === "exited" || completion) state = "completed";
  else if (launch.terminal || groupsAbsent) state = "terminated";
  else state = "live-or-unknown";
  return { launchId: launch.id, state, groupsAbsent, completion };
};

/** Fresh process observations never rewrite the stored ownership or terminal facts. */
export const readStatus = (config: string, changed = false) => {
  const project = ProjectOperation.inspect(commandRoot(config));
  const launchStatus = (project?.launches ?? []).map(launch => {
    const completion = project!.completions.find(c => c.launchId === launch.id) ?? null;
    if (completion && (completion.projectId !== project!.projectId || completion.generation !== project!.generation ||
        completion.leaderPid !== launch.leaderPid || completion.groupId !== launch.groupId)) {
      throw new SiloError(`Completion provenance differs from the grant for launch ${launch.id}; ownership retained`, "COMPLETION_PROVENANCE_MISMATCH", {
        details: { launchId: launch.id, projectId: project!.projectId, generation: project!.generation },
      });
    }
    return observedLaunch(launch, completion);
  });
  const operationOwnerAbsent = project?.operation?.pid != null && processAbsent(project.operation.pid);
  const cleanupRequired = project?.phase === "cleanup-required" || operationOwnerAbsent || launchStatus.some((observation, index) =>
    ["completed", "terminated"].includes(observation.state) && !project!.launches[index]!.reconciled,
  );
  return { schemaVersion: 1 as const, legacy: false as const, changed, project, launchStatus, operationOwnerAbsent, cleanupRequired };
};

export const status = async (options: { config: string }): Promise<void> => {
  const { project, launchStatus, cleanupRequired, operationOwnerAbsent } = readStatus(options.config);
  if (!project?.allocation) { logger.info("No allocated instance. Run env or up to allocate."); return; }
  const allocation = project.allocation;
  logger.info(`Instance: ${allocation.state.name}`);
  logger.info(`Project: ${project.projectId}; generation: ${project.generation}`);
  logger.info(`State: ${project.phase}`);
  if (project.problem) logger.warn(project.problem);
  if (project.operation) logger.info(`Operation: ${project.operation.token}, pid ${project.operation.pid}`);
  if (operationOwnerAbsent) logger.warn("Recorded operation owner is absent; down must recover it.");
  for (const [index, launch] of project.launches.entries()) {
    const observation = launchStatus[index]!;
    logger.info(`Launch ${launch.id}: ${launch.kind}, stored ${launch.phase}; observed ${observation.state}; ${observation.groupsAbsent ? "recorded groups absent" : "group absence unproven"}`);
  }
  if (cleanupRequired) logger.warn("Cleanup required; ownership is retained. Run down to reconcile.");
  for (const resource of project.resources) logger.info(`Resource: ${resource.kind}/${resource.name} (${resource.id}), ${resource.createdAt}`);
  let tiltLive = false;
  for (const launch of project.launches.filter(l => l.kind === "tilt-up" && !l.terminal)) if (await commandLiveness(launch) === "live") tiltLive = true;
  runningStackHintLines({ tiltRunning: tiltLive, tiltPort: allocation.state.ports.TILT_PORT, urls: allocation.urls, kubeconfigPath: allocation.state.identity.kubeconfigPath }).forEach(line => logger.info(line));
  logKeyValues("Ports", allocation.state.ports);
  logKeyValues("URLs", allocation.urls);
  logger.info("Status is read-only; use down to reconcile this owner's resources. Process liveness is not application readiness.");
};
