import { ProjectOperation } from "../core/lease_store";
import { storedConfig } from "../core/allocation";
import { writeEnvAndLockfile } from "../core/env";
import { startTilt } from "../backends/tilt";
import { captureFinishedProducers } from "../backends/ownership";
import { logger, logKeyValues } from "../utils/logger";
import { runningStackHintLines } from "../utils/breadcrumbs";
import { SiloError } from "../utils/errors";
import { commandFailure, commandLiveness, type OwnedCommandResult, type RunningCommand } from "../core/owned_command";
import { prepareTiltEnvironment, withAllocation } from "./prepare";

export const up = async (name: string | undefined, options: {
  config: string; force: boolean; profile: string | undefined;
  executorEntrypoint?: string;
}): Promise<boolean> => {
  const started = await withAllocation(name, options, async (owner, allocation): Promise<{ command: RunningCommand; root: string; projectId: string; generation: number } | null> => {
    let existing;
    for (const launch of owner.launches().filter(l => !l.terminal && l.kind === "tilt-up")) {
      const state = await commandLiveness(launch);
      if (state === "unknown") throw new SiloError("CLEANUP_REQUIRED: recorded supervisor identity is live or unknown; no replacement started", "CLEANUP_REQUIRED");
      if (state === "live") existing = launch;
    }
    if (existing) {
      writeEnvAndLockfile(owner);
      logger.info(`Instance '${allocation.state.name}' is already running (supervisor ${existing.supervisorPid}); generation ${owner.generation}`);
      logKeyValues("Ports", allocation.state.ports);
      logger.info("Run down before changing it. Parallel stacks need separate roots and names.");
      return null;
    }
    const env = await prepareTiltEnvironment(owner);
    const config = storedConfig(allocation);
    const command = await startTilt(owner, env, config.tilt?.webMode);
    const current = owner.current()!.allocation;
    owner.update({ ...current, state: { ...current.state, tiltPid: command.launch.supervisorPid!, tiltStartedAt: new Date().toISOString() } }, "running");
    writeEnvAndLockfile(owner);
    runningStackHintLines({ tiltRunning: true, tiltPort: current.state.ports.TILT_PORT, urls: current.urls, kubeconfigPath: current.state.identity.kubeconfigPath }).forEach(line => logger.info(line));
    return { command, root: owner.root, projectId: owner.projectId, generation: owner.generation };
  });
  if (!started) return false;
  const stop = () => started.command.stop();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  let result: OwnedCommandResult;
  try { result = await started.command.exited; }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  let owner: ProjectOperation;
  try { owner = await ProjectOperation.open(started.root); }
  catch (error) {
    if (error instanceof SiloError && error.code === "BUSY") return true; // down owns reconciliation and fences this callback.
    throw error;
  }
  try {
    if (owner.projectId !== started.projectId || owner.generation !== started.generation) return true;
    const observed = owner.current()!;
    const journal = owner.launches().find(l => l.id === result.launch.id);
    if (observed.phase !== "running" || observed.allocation.state.tiltPid !== result.launch.supervisorPid || journal?.phase !== "granted") return true;
    const recorded = owner.recordCommandResult(result.launch);
    result = { ...result, launch: recorded, exitCode: recorded.exitCode ?? result.exitCode };
    await captureFinishedProducers(owner);
    const current = owner.current()!;
    const { tiltPid: _pid, tiltStartedAt: _at, ...state } = current.allocation.state;
    const phase = result.exitCode === 0 ? (owner.resources().length > 0 ? "retained" : "stopped") : "cleanup-required";
    owner.update({ ...current.allocation, state }, phase, result.exitCode === 0 ? null : `Tilt exited ${result.exitCode}; down must reconcile before reuse`);
    writeEnvAndLockfile(owner);
  } catch (error) {
    const current = owner.current();
    if (current) owner.update(current.allocation, "cleanup-required", error instanceof Error ? error.message : String(error));
    throw error;
  } finally { owner.finish(); }
  if (result.exitCode !== 0) throw commandFailure(result, "tilt-up", started.generation);
  return true;
};
