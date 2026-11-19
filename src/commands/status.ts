import { ProjectOperation, processAbsent } from "../core/lease_store";
import type { ExecutorCompletion, Launch } from "../core/lease_types";
import { runningStackHintLines } from "../utils/breadcrumbs";
import { logger, logKeyValues } from "../utils/logger";
import { commandRoot } from "./prepare";
import { commandLiveness } from "../core/owned_command";
import { SiloError } from "../utils/errors";
import { ZodError } from "zod";
import { accountStorePath } from "../core/allocation_domain";
import { distinctDefaults, hostConfigPath, queuedDefaults, readHostCaps, resolveSlotCap, type ProjectDefault, type SlotCap } from "../core/host_caps";
import { SlotQueue, runEndedByEsrch } from "../core/slot_store";
import { SlotNameSchema, hostOs, projectCapOn, type HostCaps, type SlotName } from "../core/slot_types";
import { parseConfig } from "../core/config";
import type { ResolvedConfig } from "../core/types";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

type SlotHolder = {
  unit: number; runId: string; root: string; command: string[];
  pid: number; groupId: number | null; since: string;
  // A fresh ESRCH-only observation; status never releases.
  state: "held" | "ended (releasing)";
};
type SlotStatus = {
  slot: string;
  // The cap a grant would use now; 0 when the host turns the slot off, null when nothing caps it.
  cap: number | null;
  capSource: "host" | "project" | null;
  hostFile: string | null;
  // Every project default that applies: queued runs' and the current project's.
  projectCaps: ProjectDefault[];
  held: number; waiting: number; holders: SlotHolder[];
};

/** The current project's defaults on this OS, as its next run would record them. */
type CurrentProject = { root: string; defaults: ReadonlyMap<SlotName, number | undefined> };

const capValue = (cap: SlotCap): number | null => {
  switch (cap.kind) {
    case "host": case "project": return cap.cap;
    case "off": return 0;
    case "none": return null;
  }
};

/** Host-wide slot holders and waiters; reads the store, host caps and project config without changing any. */
const readSlotStatus = (storePath: string, host: HostCaps, project: CurrentProject | null): SlotStatus[] => {
  const runs = SlotQueue.inspect(storePath);
  const names = new Set<SlotName>([...host.keys(), ...(project?.defaults.keys() ?? []), ...runs.flatMap(queued => queued.run.requests.map(request => request.slot))]);
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
    const own = project?.defaults.get(slot);
    const projectCaps = [...queuedDefaults(runs, slot), ...(own === undefined ? [] : [{ root: project!.root, cap: own }])];
    const resolved = resolveSlotCap(host, slot, projectCaps);
    const fromHost = resolved.kind === "host" || resolved.kind === "off";
    return {
      slot, cap: capValue(resolved), capSource: fromHost ? "host" : resolved.kind === "project" ? "project" : null,
      hostFile: fromHost ? hostConfigPath() : null, projectCaps: distinctDefaults(projectCaps),
      held: holders.length, waiting, holders,
    };
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
  const slots = slotSection(config);
  return { schemaVersion: 1 as const, legacy: false as const, changed, project, launchStatus, operationOwnerAbsent, cleanupRequired, slots };
};

/** A missing silo.toml declares nothing; an invalid one is a slot-section problem like an invalid host file. */
const currentProject = (config: string): CurrentProject | null => {
  const configPath = path.resolve(config);
  if (!existsSync(configPath)) return null;
  let slots: ResolvedConfig["slots"];
  try { slots = parseConfig(readFileSync(configPath, "utf8"), configPath).slots; }
  catch (error) {
    if (error instanceof ZodError) throw new SiloError(`INVALID_CONFIG: ${configPath}: ${error.issues[0]?.message ?? "invalid"}`, "INVALID_CONFIG", { cause: error });
    throw error;
  }
  const os = hostOs();
  const defaults = new Map<SlotName, number | undefined>();
  for (const [name, declared] of Object.entries(slots)) defaults.set(SlotNameSchema.parse(name), projectCapOn(declared.cap, os));
  return { root: commandRoot(config), defaults };
};

type SlotSection = { list: SlotStatus[]; problem: { code: string; message: string } | null };

/**
 * Slot state is host-wide; an unreadable host file or slot queue is reported
 * here and never fails a project's status or lifecycle result.
 */
const slotSection = (config: string): SlotSection => {
  try { return { list: readSlotStatus(accountStorePath(), readHostCaps(), currentProject(config)), problem: null }; }
  catch (error) {
    if (error instanceof SiloError) return { list: [], problem: { code: error.code, message: error.message } };
    if (error instanceof ZodError) return { list: [], problem: { code: "SLOT_STATE_INVALID", message: `slot queue row does not parse: ${error.issues[0]?.message ?? "invalid"}` } };
    throw error;
  }
};

const sourceLabel = (slot: SlotStatus): string => {
  if (slot.capSource === "project" && slot.projectCaps.length > 1) return `project (smallest of ${slot.projectCaps.length})`;
  return slot.capSource ?? "none";
};

const time = (iso: string): string => `${iso.slice(11, 19)}Z`;

const logSlots = ({ list: slots, problem }: SlotSection): void => {
  if (problem) logger.warn(`Slots unavailable: ${problem.message}`);
  if (slots.length === 0) return;
  const rows = [["slot", "cap", "source", "held", "holder", "since", "waiting"]];
  for (const slot of slots) {
    const [first, ...rest] = slot.holders;
    const holder = (h: SlotHolder | undefined) => h ? `#${h.unit} ${h.root}  pid ${h.pid}  ${h.state === "held" ? h.command.join(" ") : h.state}` : "";
    rows.push([slot.slot, slot.cap === null ? "none" : String(slot.cap), sourceLabel(slot), String(slot.held), holder(first), first ? time(first.since) : "", String(slot.waiting)]);
    for (const h of rest) rows.push(["", "", "", "", holder(h), time(h.since), ""]);
  }
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  logger.info("Slots (host-wide):");
  for (const row of rows) logger.info(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd());
  const hostFile = slots.find(slot => slot.hostFile !== null)?.hostFile;
  if (hostFile) logger.info(`Host caps: ${hostFile}`);
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
