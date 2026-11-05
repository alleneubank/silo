import { ProjectOperation } from "../core/lease_store";
import { storedConfig } from "../core/allocation";
import { writeEnvAndLockfile } from "../core/env";
import { runHooks } from "../hooks/runner";
import { deleteCluster } from "../backends/k3d";
import { assertEngine, assertNamesAvailable, captureOwnedResources, deleteOwnedContainers, findAnonymousLeaks, verifyResource } from "../backends/ownership";
import { tiltDown } from "../backends/tilt";
import { stopOwnedCommand } from "../core/owned_command";
import { logger } from "../utils/logger";
import { SiloError } from "../utils/errors";
import { commandRoot, processEnvironment } from "./prepare";

const terminalGroups = (owner: ProjectOperation): void => {
  for (const launch of owner.launches()) owner.markLaunchTerminal(launch.id);
};

export const down = async (options: { config: string; "delete-cluster": boolean; clean: boolean; executorEntrypoint?: string }): Promise<boolean> => {
  const root = commandRoot(options.config);
  if (ProjectOperation.inspect(root) === null) { logger.info("No allocated instance. Nothing to stop."); return false; }
  const owner = await ProjectOperation.open(root, { recover: true, ...(options.executorEntrypoint === undefined ? {} : { executorEntrypoint: options.executorEntrypoint }) });
  try {
    const initial = owner.current();
    if (!initial) { logger.info("No allocated instance. Nothing to stop."); return false; }
    for (const role of ["env", "lock", "kubeconfig"] as const) if (owner.fileReceipt(role)) owner.file(role).recover();
    const config = storedConfig(initial.allocation);
    const env = processEnvironment(owner);
    for (const launch of owner.launches()) await stopOwnedCommand(launch);
    terminalGroups(owner);
    owner.applyCompletions();
    const missing = owner.launches().find(l => l.phase === "granted");
    if (missing) throw new SiloError(`CLEANUP_REQUIRED: ${missing.kind}/${missing.id} has no completion fact; process death cannot resolve an outstanding request`, "CLEANUP_REQUIRED");
    const effects = owner.launches().filter(l => l.phase === "exited" && !l.reconciled && l.effect !== "none");
    const hadWorkload = effects.some(l => l.effect === "workload");
    const needsTiltTeardown = hadWorkload || effects.some(l => l.kind === "tilt-down");
    if (effects.length > 0 || owner.resources().length > 0) {
      await assertEngine(owner);
      await captureOwnedResources(owner, "compose");
      const completedCreate = owner.launches().find(l => l.kind === "k3d-cluster-create" && l.phase === "exited" && l.exitCode === 0);
      await captureOwnedResources(owner, "k3d", completedCreate);
      await assertNamesAvailable(owner.resourceClaims(), owner.root, owner.resources());
    }
    if (effects.length > 0) {
      await runHooks(owner, { hooks: config.hooks["pre-down"], env, phase: "pre-down" });
    }
    // Remove receipted parents with their anonymous mounts before Tilt can
    // discard the parent handle. Mount names themselves confer no authority.
    await deleteOwnedContainers(owner, "compose");
    if (needsTiltTeardown) {
      const result = await tiltDown(owner, env);
      owner.checkpointLaunch({ ...result.launch, reconciled: true });
    }
    for (const receipt of owner.resources()) if (!(await verifyResource(owner, receipt))) owner.forgetResource(receipt);
    if (options["delete-cluster"] && owner.resources().some(r => r.source === "k3d")) await deleteCluster(owner);
    if (effects.length > 0) {
      await runHooks(owner, { hooks: config.hooks["post-down"], env, phase: "post-down" });
      await captureOwnedResources(owner, "compose");
    }
    terminalGroups(owner);
    const leaks = await findAnonymousLeaks(owner);
    const leakProblem = leaks.length > 0 ? `Leaked anonymous volumes: ${leaks.map(v => v.name).join(", ")}. Silo never deletes volumes by name; resolve this data with its owner.` : null;
    if (leakProblem) logger.warn(leakProblem);
    for (const launch of owner.launches()) {
      if (launch.phase === "planned") owner.markLaunchTerminal(launch.id);
      else if (launch.phase === "exited" && (launch.effect === "none" || launch.effect === "workload" || launch.effect === "hook" || launch.exitCode === 0)) {
        owner.checkpointLaunch({ ...launch, reconciled: true });
      }
    }
    const uncertain = owner.launches().filter(l => l.phase === "granted" || (l.phase === "exited" && !l.reconciled));
    if (uncertain.length > 0) {
      throw new SiloError(`CLEANUP_REQUIRED: unresolved external requests (${uncertain.map(l => `${l.kind}/${l.id}`).join(", ")}); process death and empty listings cannot cancel them. Claims retained.`, "CLEANUP_REQUIRED");
    }
    const current = owner.current()!;
    const { tiltPid: _pid, tiltStartedAt: _at, ...state } = current.allocation.state;
    const retained = owner.resources();
    const hasRetainedData = retained.length > 0 || leaks.length > 0;
    owner.update({ ...current.allocation, state }, retained.length > 0 ? "retained" : "stopped", leakProblem);
    if (options.clean) {
      if (retained.length > 0) throw new SiloError(`CLEANUP_REQUIRED: retained resources (${retained.map(r => `${r.kind}/${r.name}`).join(", ")}); ownership snapshots and claims kept. Explicit cluster deletion removes owned containers/networks. Silo never deletes volumes by name; resolve retained named volumes with their owner.`, "CLEANUP_REQUIRED");
      const proof = await owner.prepareRetirement();
      for (const role of ["env", "kubeconfig", "lock"] as const) if (owner.fileReceipt(role)) owner.file(role).remove();
      owner.retire(proof);
      logger.info("Removed owned snapshots and released this generation's claims.");
    } else {
      writeEnvAndLockfile(owner);
      logger.info(hasRetainedData ? "Stopped Tilt; resources and claims retained. Inspect status before clean." : "Stopped; allocation remains reserved until down --clean.");
    }
    return options.clean || options["delete-cluster"] || effects.length > 0 || initial.phase !== (retained.length > 0 ? "retained" : "stopped");
  } catch (error) {
    const current = owner.current();
    if (current) owner.noteFailure(error);
    throw error;
  } finally { owner.finish(); }
};
