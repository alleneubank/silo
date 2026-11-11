import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { K3D_CREATE_TIMEOUT_MS, K3D_LIST_TIMEOUT_MS } from "../core/constants";
import type { ProjectOperation } from "../core/lease_store";
import { commandFailure, startImageCacheCreation } from "../core/owned_command";
import { inspectObject } from "./docker";
import { K3D_CLUSTER_CREATE_KIND, assertEngine, assertNamesAvailable, captureFinishedProducers, runProducerCommand, deleteOwnedContainers, deleteOwnedNetworks, deleteOwnedImageCaches, verifyResource } from "./ownership";

const CONTROL_FLAGS = new Set([
  "--config", "-c", "--network", "--registry-create", "--api-port", "--runtime-label",
  "--kubeconfig-update-default", "--kubeconfig-switch-context", "--token", "--no-rollback",
]);

/** User args may tune the cluster, but cannot replace its identity, file or port claims. */
export const validateK3dArgs = (args: string[], ports: Record<string, number>): void => {
  const declared = new Set(Object.values(ports));
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const flag = arg.split("=", 1)[0]!;
    if (CONTROL_FLAGS.has(flag)) throw new SiloError(`INVALID_CONFIG: silo owns k3d ${flag}; remove it from k3d.args`, "INVALID_CONFIG");
    if (flag === "--port" || flag === "-p") {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
      const mapping = /^(?:(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::\]|\[::1\]):)?(\d+):(\d+)(?:\/(?:tcp|udp))?(?:@[A-Za-z0-9_:;,.*-]+)?$/.exec(value ?? "");
      const hostPort = Number(mapping?.[1]);
      const containerPort = Number(mapping?.[2]);
      if (!mapping || !declared.has(hostPort) || containerPort < 1 || containerPort > 65535) {
        throw new SiloError(`INVALID_CONFIG: k3d port mapping must publish a declared allocated host port: ${value ?? "missing value"}`, "INVALID_CONFIG");
      }
    }
  }
};

export const stripDebugOutput = (output: string): string => output.split("\n").filter(line => {
  // oxlint-disable-next-line no-control-regex -- intentionally matching ANSI escapes
  const ansi = /\x1b\[[0-9;]*[a-zA-Z]/;
  return !ansi.test(line) && !/^(DEBU|INFO|WARN|ERRO)\[/.test(line);
}).join("\n");

const recordCreation = async (owner: ProjectOperation, command: string[], kind: string): Promise<void> => {
  await runProducerCommand(owner, command, { kind, effect: "create", timeoutMs: K3D_CREATE_TIMEOUT_MS });
};

export const createImageCache = async (owner: ProjectOperation): Promise<void> => {
  await assertEngine(owner);
  await assertNamesAvailable(owner.resourceClaims(), owner, owner.resources());
  const running = await startImageCacheCreation(owner, K3D_CREATE_TIMEOUT_MS);
  const result = await running.exited;
  const launch = owner.recordCommandResult(result.launch);
  if (launch.exitCode !== 0) {
    await captureFinishedProducers(owner);
    throw commandFailure({ ...result, launch, exitCode: launch.exitCode ?? result.exitCode }, launch.kind, owner.generation);
  }
  await assertEngine(owner);
  const name = launch.cacheCreation!.name;
  const observed = await inspectObject({ kind: "volume", name, id: name }, "k3d", owner);
  owner.recordImageCacheCreation(launch.id, observed.receipt);
  owner.markLaunchTerminal(launch.id);
  owner.checkpointLaunch({ ...launch, terminal: true, reconciled: true });
};

/** Every backend mutation is bound to this allocation, never to a lockfile name. */
export const ensureCluster = async (owner: ProjectOperation): Promise<void> => {
  const current = owner.current();
  if (!current) throw new Error("Cluster creation requires an allocation");
  const allocation = current.allocation;
  const cluster = allocation.state.identity.k3dClusterName;
  if (!cluster) return;
  await assertEngine(owner);
  await assertNamesAvailable(owner.resourceClaims(), owner, owner.resources());
  if (allocation.state.k3dClusterCreated) {
    for (const receipt of owner.resources().filter(r => r.source === "k3d")) {
      if (!(await verifyResource(owner, receipt))) throw new SiloError(`CLEANUP_REQUIRED: retained resource disappeared: ${receipt.name}`, "CLEANUP_REQUIRED");
    }
    return;
  }
  const labels = ["--label", `io.silo.project=${owner.projectId}`, "--label", `io.silo.generation=${owner.generation}`, "--label", `k3d.cluster=${cluster}`];
  await recordCreation(owner, ["docker", "network", "create", ...labels, `k3d-${cluster}`], "k3d-network-create");
  await createImageCache(owner);
  const command = [
    "k3d", "cluster", "create", cluster, "--no-rollback",
    "--kubeconfig-update-default=false", "--kubeconfig-switch-context=false",
    "--network", `k3d-${cluster}`, "--api-port", `127.0.0.1:${allocation.state.ports.K3D_API_PORT}`,
    "--runtime-label", `io.silo.project=${owner.projectId}@all`,
    "--runtime-label", `io.silo.generation=${owner.generation}@all`,
  ];
  if (allocation.state.identity.k3dRegistryName) command.push("--registry-create", allocation.state.identity.k3dRegistryName);
  command.push(...allocation.k3dArgs);
  await recordCreation(owner, command, K3D_CLUSTER_CREATE_KIND);
  owner.update({ ...allocation, state: { ...allocation.state, k3dClusterCreated: true } }, current.phase);
};

export const writeKubeconfig = async (owner: ProjectOperation): Promise<void> => {
  const allocation = owner.current()?.allocation;
  const cluster = allocation?.state.identity.k3dClusterName;
  if (!cluster || !allocation.state.identity.kubeconfigPath) return;
  await assertEngine(owner);
  const result = await runCommand(["k3d", "kubeconfig", "get", cluster], {
    cwd: owner.root, ...(owner.signal === undefined ? {} : { signal: owner.signal }), timeoutMs: K3D_LIST_TIMEOUT_MS, context: "owned kubeconfig read", stdio: "pipe",
  });
  if (result.exitCode !== 0) throw new SiloError("KUBECONFIG_FAILED: could not read owned cluster kubeconfig", "KUBECONFIG_FAILED");
  owner.file("kubeconfig").publish(stripDebugOutput(result.stdout));
};

/** Deletes only exact journaled Docker objects; k3d's name/label-wide delete is not used. */
export const deleteCluster = async (owner: ProjectOperation): Promise<void> => {
  await assertEngine(owner);
  await assertNamesAvailable(owner.resourceClaims(), owner, owner.resources());
  await deleteOwnedContainers(owner, "k3d");
  await deleteOwnedNetworks(owner, "k3d");
  await deleteOwnedImageCaches(owner);
  const current = owner.current()!;
  owner.update({ ...current.allocation, state: { ...current.allocation.state, k3dClusterCreated: false } }, "stopped");
};
