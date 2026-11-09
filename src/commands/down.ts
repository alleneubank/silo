import { ProjectOperation } from "../core/lease_store";
import { writeEnvAndLockfile } from "../core/env";
import { deleteCluster } from "../backends/k3d";
import { assertEngine, assertNamesAvailable, captureFinishedProducers, deleteOwnedContainers, deleteOwnedNetworks, findAnonymousLeaks, verifyResource } from "../backends/ownership";
import { stopOwnedCommand } from "../core/owned_command";
import { logger } from "../utils/logger";
import { SiloError } from "../utils/errors";
import { resourceReceiptKey } from "../core/lease_types";
import { commandRoot } from "./prepare";

const terminalGroups = (owner: ProjectOperation): void => {
  for (const launch of owner.launches()) owner.markLaunchTerminal(launch.id);
};

export const down = async (options: { config: string; "delete-cluster": boolean; clean: boolean; executorEntrypoint?: string }): Promise<boolean> => {
  const root = commandRoot(options.config);
  const owner = await ProjectOperation.openExisting(root, { recover: true, ...(options.executorEntrypoint === undefined ? {} : { executorEntrypoint: options.executorEntrypoint }) });
  if (!owner) { logger.info("No allocated instance. Nothing to stop."); return false; }
  try {
    const initial = owner.current();
    if (!initial) { logger.info("No allocated instance. Nothing to stop."); return false; }
    for (const role of ["env", "lock", "kubeconfig"] as const) if (owner.fileReceipt(role)) owner.file(role).recover();
    for (const launch of owner.launches()) await stopOwnedCommand(launch);
    terminalGroups(owner);
    owner.applyCompletions();
    for (const launch of owner.launches()) {
      const target = launch.deletionTarget;
      if (!launch.terminal || launch.reconciled || launch.effect !== "delete" || !target) continue;
      const receipt = owner.resources(true).find(r => target.kind === "image-cache" ? resourceReceiptKey(r) === target.receiptKey : r.kind === target.kind && r.id === target.id);
      if (receipt && !(await verifyResource(owner, receipt))) owner.recordResourceAbsence(receipt);
    }
    const missing = owner.launches().find(l => l.phase === "granted");
    if (missing) throw new SiloError(`CLEANUP_REQUIRED: ${missing.kind}/${missing.id} has no completion fact; process death cannot resolve an outstanding request`, "CLEANUP_REQUIRED");
    await captureFinishedProducers(owner);
    const effects = owner.launches().filter(l => l.phase === "exited" && !l.reconciled && l.effect !== "none");
    if (effects.length > 0 || owner.resources().length > 0) {
      await assertEngine(owner);
      await assertNamesAvailable(owner.resourceClaims(), owner.root, owner.resources());
    }
    // Finished producers are sealed above. No capture can run after deletion
    // starts or renew authority on a later cleanup retry.
    await deleteOwnedContainers(owner, "compose");
    await deleteOwnedNetworks(owner, "compose");
    for (const receipt of owner.resources()) if (!(await verifyResource(owner, receipt))) owner.recordResourceAbsence(receipt);
    if (options["delete-cluster"] && owner.resources().some(r => r.source === "k3d")) await deleteCluster(owner);
    terminalGroups(owner);
    const leaks = await findAnonymousLeaks(owner);
    const leakProblem = leaks.length > 0 ? `Leaked anonymous volumes: ${leaks.map(v => v.name).join(", ")}. Silo never deletes anonymous volumes by name; resolve this data with its owner.` : null;
    if (leakProblem) logger.warn(leakProblem);
    for (const launch of owner.launches()) {
      if (launch.phase === "planned") owner.markLaunchTerminal(launch.id);
      else if (launch.phase === "exited" && (launch.effect === "none" || (launch.effect === "delete" && launch.exitCode === 0 && launch.deletionTarget?.kind !== "image-cache"))) {
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
      if (retained.length > 0) throw new SiloError(`CLEANUP_REQUIRED: retained resources (${retained.map(r => `${r.kind}/${r.name}`).join(", ")}); ownership snapshots and claims kept. Explicit cluster deletion removes owned containers/networks and receipt-verified image caches. Resolve other retained named volumes with their owner.`, "CLEANUP_REQUIRED");
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
