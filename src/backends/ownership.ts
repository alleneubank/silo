import { realpathSync } from "node:fs";
import { z } from "zod";
import { MAX_OBJECTS, ListRowSchema, enumerate, inspectObject, query, captureEngine, type NamespaceEntry, type InspectedObject } from "./docker";
export { captureEngine } from "./docker";
import { SiloError } from "../utils/errors";
import type { ProjectOperation } from "../core/lease_store";
import type { Allocation, AnonymousVolume, BackendReceipt, Claim, Launch, ObservedBackendReceipt } from "../core/lease_types";
import { isOwnedImageCache, matchesResource, resourceReceiptKey } from "../core/lease_types";
import { commandFailure, runOwnedCommand, runImageCacheDeletion, startOwnedCommand, type CommandOptions } from "../core/owned_command";
import { K3D_DELETE_TIMEOUT_MS } from "../core/constants";

type FinishedProducer = Extract<Launch, { phase: "exited" }> & {
  started: true; exitCode: number; effect: "create" | "workload" | "hook";
};
/** Which finished launches a capture may attribute unlabelled outputs to. */
type CaptureProvenance = { registryRequested: boolean; composeLaunched: boolean };

/** The only launch kind that asks k3d to create the claimed registry. */
export const K3D_CLUSTER_CREATE_KIND = "k3d-cluster-create";

export const assertEngine = async (owner: ProjectOperation): Promise<NonNullable<Allocation["engine"]>> => {
  const current = owner.current();
  if (!current) throw new Error("Backend operation requires an allocation");
  const engine = await captureEngine(owner.root);
  if (current.allocation.engine && (engine.id !== current.allocation.engine.id || engine.endpoint !== current.allocation.engine.endpoint)) {
    throw new SiloError("ENGINE_CHANGED: Docker endpoint or engine ID differs from the allocation; no backend effect permitted", "ENGINE_CHANGED");
  }
  return engine;
};

const selected = (entry: NamespaceEntry, claims: Claim[]): boolean => claims.some(c =>
  c.domain === entry.kind && (c.resource === entry.name || (c.prefix && entry.name.startsWith(c.resource))),
);

/** A cooperating tool must not publish this owner's labels outside its claims. */
const assertLabelledScope = async (owner: ProjectOperation, entries: NamespaceEntry[]): Promise<void> => {
  const claims = owner.resourceClaims();
  for (const kind of ["container", "network", "volume"] as const) {
    const output = await query(["docker", kind, "ls", ...(kind === "container" ? ["-a"] : []), ...(kind === "volume" ? [] : ["--no-trunc"]),
      "--filter", `label=io.silo.project=${owner.projectId}`, "--filter", `label=io.silo.generation=${owner.generation}`, "--format", "{{json .}}"], owner.root);
    const lines = output.split("\n").filter(line => line.trim().length > 0);
    if (lines.length > MAX_OBJECTS) throw new SiloError("ENGINE_UNAVAILABLE: owner namespace exceeds enumeration limit", "ENGINE_UNAVAILABLE");
    for (const line of lines) {
      const row = ListRowSchema.parse(JSON.parse(line));
      const name = kind === "container" ? row.Names : row.Name;
      const entry = entries.find(e => e.kind === kind && e.name === name && (kind === "volume" || e.id === row.ID));
      if (!entry) throw new SiloError("ENGINE_UNAVAILABLE: owner query differs from complete namespace", "ENGINE_UNAVAILABLE");
      if (!selected(entry, claims)) throw new SiloError(`NAME_CONFLICT: owned tool created ${kind}/${entry.name} (${entry.id}) outside declared names. Configure Tilt docker_compose(project_name=COMPOSE_PROJECT_NAME) and claimed names; no cleanup authority was granted for this object.`, "NAME_CONFLICT");
    }
  }
};

const conflict = (entry: NamespaceEntry): never => {
  throw new SiloError(`NAME_CONFLICT: existing ${entry.kind} '${entry.name}' has no matching ownership receipt. Inspect with docker ${entry.kind} inspect ${entry.id}; silo will not reuse or delete it.`, "NAME_CONFLICT", { details: { kind: entry.kind, name: entry.name, id: entry.id } });
};

const assertResourceMatch = (receipt: BackendReceipt, observed: ObservedBackendReceipt, entry: NamespaceEntry): void => {
  if (matchesResource(receipt, observed)) return;
  if (isOwnedImageCache(receipt)) throw new SiloError(`CLEANUP_REQUIRED: owned image-cache identity differs: ${receipt.name}`, "CLEANUP_REQUIRED");
  conflict(entry);
};

const exactK3dNames = async (claims: Claim[], owned: BackendReceipt[], cwd: string): Promise<void> => {
  for (const [domain, command] of [["k3d-cluster", "cluster"], ["k3d-registry", "registry"]] as const) {
    const names = claims.filter(c => c.domain === domain).map(c => c.resource);
    if (names.length === 0) continue;
    const values = z.array(z.object({ name: z.string() })).max(MAX_OBJECTS).parse(JSON.parse(await query(["k3d", command, "list", "-o", "json"], cwd)));
    for (const name of names) {
      if (!values.some(v => v.name === name || (command === "registry" && v.name === `k3d-${name}`))) continue;
      const hasReceipt = owned.some(r => r.source === "k3d" && r.kind === "container" && (command === "cluster" ? r.labels["k3d.cluster"] === name : r.name === name));
      if (!hasReceipt) throw new SiloError(`NAME_CONFLICT: existing k3d ${command} '${name}' has no ownership receipt. Inspect with k3d ${command} get ${name}; silo will not reuse or delete it.`, "NAME_CONFLICT");
    }
  }
};

export const assertNamesAvailable = async (claims: Claim[], cwd: string, owned: BackendReceipt[] = []): Promise<void> => {
  await exactK3dNames(claims, owned, cwd);
  const entries = await enumerate(cwd);
  for (const entry of entries.filter(e => selected(e, claims))) {
    const prior = owned.find(r => r.kind === entry.kind && r.name === entry.name);
    if (!prior) return conflict(entry);
    const current = await inspectObject(entry, prior.source, cwd);
    assertResourceMatch(prior, current.receipt, entry);
  }
};

/** Records only this generation's creation results, with its declared namespace and provenance. */
const captureOwnedResources = async (owner: ProjectOperation, source: BackendReceipt["source"], provenance: CaptureProvenance): Promise<ObservedBackendReceipt[]> => {
  await assertEngine(owner);
  const allocation = owner.current()!.allocation;
  const cluster = allocation.state.identity.k3dClusterName;
  const registry = allocation.state.identity.k3dRegistryName?.split(":")[0];
  const validatePublications = (current: InspectedObject): void => {
    const declared = new Set(Object.values(allocation.state.ports));
    if (current.publishedPorts.some(port => !declared.has(port))) {
      throw new SiloError(`PORT_BIND_CONFLICT: ${current.receipt.name} published an unclaimed port; no snapshot renumbering permitted`, "PORT_BIND_CONFLICT");
    }
    const expected = current.receipt.name === registry ? ["5000/tcp", allocation.state.ports.K3D_REGISTRY_PORT] as const :
      current.receipt.name === `k3d-${cluster}-serverlb` ? ["6443/tcp", allocation.state.ports.K3D_API_PORT] as const : null;
    if (current.running && expected) {
      const ports = current.bindings[expected[0]] ?? [];
      if (ports.length === 0 || ports.some(port => port !== expected[1])) {
        throw new SiloError(`PORT_BIND_CONFLICT: ${current.receipt.name} did not publish its assigned ${expected[0]} host port ${expected[1]}; claims and snapshots retained`, "PORT_BIND_CONFLICT");
      }
    }
  };
  const isK3d = (entry: NamespaceEntry): boolean => cluster !== undefined && (
    (entry.kind === "container" && (entry.name.startsWith(`k3d-${cluster}-`) || entry.name === registry)) ||
    (entry.kind === "network" && entry.name === `k3d-${cluster}`) ||
    (entry.kind === "volume" && entry.name === `k3d-${cluster}-images`)
  );
  const namespace = await enumerate(owner.root);
  await assertLabelledScope(owner, namespace);
  const entries = namespace.filter(e => selected(e, owner.resourceClaims()) && isK3d(e) === (source === "k3d"));
  // An absent immutable object remains in audit history, but cannot reserve a
  // name against the next creation result. No deletion occurs during capture.
  for (const receipt of owner.resources().filter(r => r.source === source)) {
    if (!namespace.some(e => e.kind === receipt.kind && (receipt.kind === "volume" ? e.name === receipt.name : e.id === receipt.id))) {
      owner.recordResourceAbsence(receipt);
    }
  }
  const prior = owner.resources();
  const captured: ObservedBackendReceipt[] = [];
  for (const entry of entries) {
    const existing = prior.find(r => r.kind === entry.kind && r.name === entry.name);
    const current = await inspectObject(entry, existing?.source ?? source, owner.root);
    if (existing) {
      assertResourceMatch(existing, current.receipt, entry);
      validatePublications(current);
      captured.push(current.receipt);
      continue;
    }
    const labels = current.receipt.labels;
    const projectLabel = labels["io.silo.project"] === owner.projectId && labels["io.silo.generation"] === String(owner.generation);
    const registryFromClusterCreate = source === "k3d" && provenance.registryRequested &&
      entry.kind === "container" && entry.name === registry &&
      labels["k3d.cluster"] === allocation.state.identity.k3dClusterName;
    const composeRoot = labels["com.docker.compose.project.working_dir"];
    const composeFromOwnedLaunch = source === "compose" && entry.kind === "container" &&
      labels["com.docker.compose.project"] === allocation.state.identity.composeName && composeRoot !== undefined &&
      realpathSync(composeRoot) === owner.root && provenance.composeLaunched;
    if (!projectLabel && !registryFromClusterCreate && !composeFromOwnedLaunch) conflict(entry);
    validatePublications(current);
    captured.push(current.receipt);
  }
  owner.recordResources(captured);
  return captured;
};

/** Seals finished producers' recording before any cleanup effect can begin. */
export const captureFinishedProducers = async (owner: ProjectOperation): Promise<void> => {
  const pending = owner.launches().filter((launch): launch is FinishedProducer =>
    launch.phase === "exited" && launch.started && launch.exitCode !== null && !launch.reconciled &&
    (launch.effect === "create" || launch.effect === "workload" || launch.effect === "hook"));
  if (pending.length === 0) return;
  for (const launch of pending) owner.markLaunchTerminal(launch.id);
  // k3d's registry carries no Silo labels; only the finished cluster create
  // that requested this exact registry may vouch for it, whatever its exit.
  const registryName = owner.current()!.allocation.state.identity.k3dRegistryName;
  const provenance: CaptureProvenance = {
    registryRequested: registryName !== undefined && pending.some(launch => launch.kind === K3D_CLUSTER_CREATE_KIND &&
      launch.command.some((arg, index) => arg === "--registry-create" && launch.command[index + 1] === registryName)),
    composeLaunched: pending.some(launch => launch.effect === "workload" || launch.effect === "hook"),
  };
  // Direct creators operate on k3d's claimed namespace. Hooks and workloads can
  // also create Compose objects, whose root/launch provenance remains required.
  await captureOwnedResources(owner, "k3d", provenance);
  if (provenance.composeLaunched) await captureOwnedResources(owner, "compose", provenance);
  for (const launch of pending) owner.checkpointLaunch({ ...launch, terminal: true, reconciled: true });
};

/** Finite producers seal their outputs even when the creating command fails. */
export const runProducerCommand = async (owner: ProjectOperation, command: string[], options: CommandOptions & { effect: "create" | "workload" | "hook" }): Promise<void> => {
  const running = await startOwnedCommand(owner, command, options);
  const result = await running.exited;
  const launch = owner.recordCommandResult(result.launch);
  const completed = { ...result, launch, exitCode: launch.exitCode ?? result.exitCode };
  await captureFinishedProducers(owner);
  if (completed.exitCode !== 0) {
    const failure = commandFailure(completed, options.kind, owner.generation);
    owner.noteFailure(failure);
    throw failure;
  }
};

/** Revalidates exact IDs and creation identities before any deletion capability is used. */
export const verifyResource = async (owner: ProjectOperation, receipt: BackendReceipt): Promise<boolean> => {
  await assertEngine(owner);
  const entries = await enumerate(owner.root);
  const entry = entries.find(e => e.kind === receipt.kind && (receipt.kind === "volume" ? e.name === receipt.name : e.id === receipt.id));
  if (!entry) return false;
  const current = await inspectObject(entry, receipt.source, owner.root);
  assertResourceMatch(receipt, current.receipt, entry);
  return true;
};

const anonymousLeaks = (entries: NamespaceEntry[], receipts: BackendReceipt[]): (AnonymousVolume & { parentId: string })[] => receipts.flatMap(parent =>
  parent.kind !== "container" || entries.some(e => e.kind === "container" && e.id === parent.id) ? [] :
    parent.anonymousVolumes.filter(volume => entries.some(e => e.kind === "volume" && e.name === volume.name)).map(volume => ({ ...volume, parentId: parent.id })),
);

export const findAnonymousLeaks = async (owner: ProjectOperation): Promise<(AnonymousVolume & { parentId: string })[]> => {
  const receipts = owner.resources(true);
  if (!receipts.some(r => r.kind === "container" && r.anonymousVolumes.length > 0)) return [];
  await assertEngine(owner);
  return anonymousLeaks(await enumerate(owner.root), receipts);
};

export const proveBackendAbsent = async (owner: ProjectOperation): Promise<void> => {
  const record = owner.current();
  if (!record?.allocation.engine && owner.resources(true).length === 0) return;
  await assertEngine(owner);
  const entries = await enumerate(owner.root);
  await assertLabelledScope(owner, entries);
  const leaks = anonymousLeaks(entries, owner.resources(true));
  if (leaks.length > 0) {
    throw new SiloError(`CLEANUP_REQUIRED: leaked anonymous volumes remain (${leaks.map(v => `${v.name} from ${v.parentId}`).join(", ")}). Silo never deletes anonymous volumes by name; resolve this data with its owner. Claims retained.`, "CLEANUP_REQUIRED", {
      details: { leakedVolumes: leaks },
    });
  }
  const residual = entries.find(e => selected(e, owner.resourceClaims()) || owner.resources(true).some(r => r.kind === e.kind && r.kind !== "volume" && r.id === e.id));
  if (residual) throw new SiloError(`CLEANUP_REQUIRED: residual ${residual.kind}/${residual.name} (${residual.id}); claims retained`, "CLEANUP_REQUIRED");
};

/** The deletion target is an immutable container/network ID, never a volume name. */
const deleteResources = async (owner: ProjectOperation, source: BackendReceipt["source"], kind: "container" | "network"): Promise<void> => {
  const deletable = owner.resources().filter((r): r is Extract<BackendReceipt, { kind: "container" | "network" }> => r.kind !== "volume");
  for (const receipt of deletable.filter(r => r.source === source && r.kind === kind)) {
    if (await verifyResource(owner, receipt)) {
      const result = await runOwnedCommand(owner, ["docker", kind, "rm", ...(kind === "container" ? ["--force", "--volumes"] : []), receipt.id], {
        kind: `owned-${kind}-delete`, effect: "delete", timeoutMs: K3D_DELETE_TIMEOUT_MS,
        deletionTarget: { kind, id: receipt.id },
      });
      if (await verifyResource(owner, receipt)) throw new SiloError(`CLEANUP_REQUIRED: deletion left ${kind}/${receipt.name}`, "CLEANUP_REQUIRED");
      owner.checkpointLaunch({ ...result.launch, reconciled: true });
    }
    owner.recordResourceAbsence(receipt);
  }
};

export const deleteOwnedContainers = (owner: ProjectOperation, source: BackendReceipt["source"]): Promise<void> => deleteResources(owner, source, "container");
export const deleteOwnedNetworks = (owner: ProjectOperation, source: BackendReceipt["source"]): Promise<void> => deleteResources(owner, source, "network");

/** Only explicit cluster deletion invokes the store's receipt-bound cache capability. */
export const deleteOwnedImageCaches = async (owner: ProjectOperation): Promise<void> => {
  for (const receipt of owner.resources().filter(isOwnedImageCache)) {
    if (await verifyResource(owner, receipt)) {
      const capability = owner.authorizeImageCacheDeletion(resourceReceiptKey(receipt));
      const result = await runImageCacheDeletion(owner, capability, K3D_DELETE_TIMEOUT_MS);
      if (await verifyResource(owner, receipt)) throw new SiloError(`CLEANUP_REQUIRED: deletion left image cache ${receipt.name}`, "CLEANUP_REQUIRED");
      owner.markLaunchTerminal(result.launch.id);
    }
    owner.recordResourceAbsence(receipt);
  }
};
