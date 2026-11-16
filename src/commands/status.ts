import { ProjectOperation, processAbsent } from "../core/lease_store";
import type { ExecutorCompletion, Launch } from "../core/lease_types";
import { runningStackHintLines } from "../utils/breadcrumbs";
import { logger, logKeyValues } from "../utils/logger";
import { commandRoot } from "./prepare";
import { commandLiveness } from "../core/owned_command";
import { SiloError } from "../utils/errors";
import { accountStorePath } from "../core/allocation_domain";
import { readHostCaps } from "../core/host_caps";
import { SlotQueue, runEndedByEsrch } from "../core/slot_store";
import type { HostCaps, SlotName } from "../core/slot_types";

type SlotHolder = {
  unit: number; runId: string; root: string; command: string[];
  pid: number; groupId: number | null; since: string;
  // A fresh ESRCH-only observation; status never releases.
  state: "held" | "ended (releasing)";
};
type SlotStatus = { slot: string; cap: number | null; held: number; waiting: number; holders: SlotHolder[] };

/** Host-wide slot holders and waiters; reads the store and host caps without changing either. */
const readSlotStatus = (storePath: string, caps: HostCaps): SlotStatus[] => {
  const runs = SlotQueue.inspect(storePath);
  const names = new Set<SlotName>([...caps.keys(), ...runs.flatMap(queued => queued.run.requests.map(request => request.slot))]);
  return [...names].sort().map((slot): SlotStatus => {
    const holders = runs.flatMap(({ run }): SlotHolder[] => {
      if (run.phase !== "held") return [];
      const grant = run.grants.find(g => g.slot === slot);
      if (!grant) return [];
      return [{
        unit: grant.unit, runId: run.id, root: run.root, command: run.command, pid: run.waiter.pid,
        groupId: run.launch?.groupId ?? null, since: run.grantedAt, state: runEndedByEsrch(run) ? "ended (releasing)" : "held",
      }];
    }).sort((a, b) => a.unit - b.unit);
    const waiting = runs.filter(({ run }) => run.phase === "waiting" && run.requests.some(request => request.slot === slot)).length;
    return { slot, cap: caps.get(slot) ?? null, held: holders.length, waiting, holders };
  });
};

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
  const slots = readSlotStatus(accountStorePath(), readHostCaps());
  return { schemaVersion: 1 as const, legacy: false as const, changed, project, launchStatus, operationOwnerAbsent, cleanupRequired, slots };
};

const time = (iso: string): string => `${iso.slice(11, 19)}Z`;

const logSlots = (slots: SlotStatus[]): void => {
  if (slots.length === 0) return;
  const rows = [["slot", "cap", "held", "holder", "since", "waiting"]];
  for (const slot of slots) {
    const [first, ...rest] = slot.holders;
    const holder = (h: SlotHolder | undefined) => h ? `#${h.unit} ${h.root}  pid ${h.pid}  ${h.state === "held" ? h.command.join(" ") : h.state}` : "";
    rows.push([slot.slot, slot.cap === null ? "none" : String(slot.cap), String(slot.held), holder(first), first ? time(first.since) : "", String(slot.waiting)]);
    for (const h of rest) rows.push(["", "", "", holder(h), time(h.since), ""]);
  }
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  logger.info("Slots (host-wide):");
  for (const row of rows) logger.info(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd());
};

export const status = async (options: { config: string }): Promise<void> => {
  const { project, launchStatus, cleanupRequired, operationOwnerAbsent, slots } = readStatus(options.config);
  logSlots(slots);
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
