import { realpathSync } from "node:fs";
import { z } from "zod";
import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import type { ProjectOperation } from "../core/lease_store";
import type { Allocation, AnonymousVolume, BackendReceipt, Claim, Launch } from "../core/lease_types";
import { BackendReceiptSchema } from "../core/lease_types";
import { runOwnedCommand } from "../core/owned_command";
import { K3D_DELETE_TIMEOUT_MS } from "../core/constants";

const MAX_OBJECTS = 10_000;
const TOOL_TIMEOUT_MS = 5000;
const EngineSchema = z.object({ ID: z.string().min(1), OSType: z.literal("linux") });
const ListRowSchema = z.object({ ID: z.string().optional(), Name: z.string().optional(), Names: z.string().optional() });
const LabelsSchema = z.record(z.string()).nullable().optional();
const InspectSchema = z.object({
  Id: z.string().optional(), Name: z.string(), Created: z.string().optional(), CreatedAt: z.string().optional(),
  Labels: LabelsSchema, Config: z.object({ Labels: LabelsSchema }).optional(),
  HostConfig: z.object({
    Binds: z.array(z.string()).max(256).nullable().optional(),
    Mounts: z.array(z.object({ Type: z.string(), Source: z.string().optional(), Target: z.string() })).max(256).optional(),
    VolumesFrom: z.array(z.string()).max(256).nullable().optional(),
  }).optional(),
  Mounts: z.array(z.object({ Type: z.string(), Name: z.string().optional(), Destination: z.string() })).max(256).optional(),
  State: z.object({ Running: z.boolean() }).optional(),
  NetworkSettings: z.object({ Ports: z.record(z.array(z.object({ HostPort: z.string() })).nullable()).nullable().optional() }).optional(),
});
type NamespaceEntry = { kind: BackendReceipt["kind"]; name: string; id: string };
type InspectedObject = { receipt: BackendReceipt; publishedPorts: number[]; bindings: Record<string, number[]>; running: boolean };

const query = async (argv: string[], cwd: string): Promise<string> => {
  const result = await runCommand(argv, { cwd, timeoutMs: TOOL_TIMEOUT_MS, context: argv.slice(0, 3).join(" "), stdio: "pipe" });
  if (result.exitCode !== 0) throw new SiloError(`ENGINE_UNAVAILABLE: ${argv.slice(0, 3).join(" ")} failed; absence is not established`, "ENGINE_UNAVAILABLE");
  return result.stdout;
};

export const captureEngine = async (cwd: string): Promise<NonNullable<Allocation["engine"]>> => {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : (await query(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], cwd)).trim();
  if (!endpoint.startsWith("unix:///") || endpoint.length > 4096) {
    throw new SiloError("ENGINE_UNSUPPORTED: silo requires a local Unix-socket Docker endpoint", "ENGINE_UNSUPPORTED");
  }
  const info = EngineSchema.parse(JSON.parse(await query(["docker", "info", "--format", "{{json .}}"], cwd)));
  return { endpoint, id: info.ID };
};

export const assertEngine = async (owner: ProjectOperation): Promise<NonNullable<Allocation["engine"]>> => {
  const current = owner.current();
  if (!current) throw new Error("Backend operation requires an allocation");
  const engine = await captureEngine(owner.root);
  if (current.allocation.engine && (engine.id !== current.allocation.engine.id || engine.endpoint !== current.allocation.engine.endpoint)) {
    throw new SiloError("ENGINE_CHANGED: Docker endpoint or engine ID differs from the allocation; no backend effect permitted", "ENGINE_CHANGED");
  }
  return engine;
};

/** Complete structured enumeration, checked against the engine's known-present bridge. */
const enumerate = async (cwd: string): Promise<NamespaceEntry[]> => {
  const entries: NamespaceEntry[] = [];
  for (const kind of ["container", "network", "volume"] as const) {
    const args = ["docker", kind, "ls", ...(kind === "container" ? ["-a"] : []), ...(kind === "volume" ? [] : ["--no-trunc"]), "--format", "{{json .}}"];
    const output = await query(args, cwd);
    const lines = output.split("\n").filter(line => line.trim().length > 0);
    if (lines.length > MAX_OBJECTS) throw new SiloError("ENGINE_UNAVAILABLE: namespace exceeds enumeration limit", "ENGINE_UNAVAILABLE");
    for (const line of lines) {
      const row = ListRowSchema.parse(JSON.parse(line));
      const name = kind === "container" ? row.Names : row.Name;
      if (!name || (kind !== "volume" && !row.ID)) throw new SiloError("ENGINE_UNAVAILABLE: incomplete namespace response", "ENGINE_UNAVAILABLE");
      entries.push({ kind, name, id: row.ID ?? name });
    }
  }
  const bridge = entries.find(e => e.kind === "network" && e.name === "bridge");
  if (!bridge) throw new SiloError("ENGINE_UNAVAILABLE: known-present bridge control missing from network enumeration", "ENGINE_UNAVAILABLE");
  const control = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", "network", "inspect", bridge.id], cwd)))[0]!;
  if (control.Id !== bridge.id || control.Name !== "bridge") throw new SiloError("ENGINE_UNAVAILABLE: enumeration control mismatch", "ENGINE_UNAVAILABLE");
  return entries;
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

const inspectObject = async (entry: NamespaceEntry, source: BackendReceipt["source"], cwd: string): Promise<InspectedObject> => {
  const value = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", entry.kind, "inspect", entry.id], cwd)))[0]!;
  if (entry.kind === "container" && !value.State) throw new SiloError(`ENGINE_UNAVAILABLE: missing container state: ${entry.name}`, "ENGINE_UNAVAILABLE");
  const labels = value.Config?.Labels ?? value.Labels ?? {};
  const safeLabels = Object.fromEntries(Object.entries(labels).filter(([key]) =>
    ["io.silo.project", "io.silo.generation", "k3d.cluster", "k3d.role", "app", "com.docker.compose.project", "com.docker.compose.project.working_dir"].includes(key),
  ));
  const createdAt = value.Created ?? value.CreatedAt;
  if (!createdAt) throw new SiloError(`ENGINE_UNAVAILABLE: missing resource creation identity: ${entry.name}`, "ENGINE_UNAVAILABLE");
  const identity = {
    source, name: value.Name.replace(/^\//, ""), id: entry.kind === "volume" ? value.Name : value.Id,
    createdAt, labels: safeLabels,
  };
  const receipt = BackendReceiptSchema.parse(entry.kind === "container"
    ? { ...identity, kind: "container", anonymousVolumes: await captureAnonymousVolumes(value, cwd) }
    : { ...identity, kind: entry.kind });
  const bindings = Object.fromEntries(Object.entries(value.NetworkSettings?.Ports ?? {}).map(([target, bindings]) => [target, (bindings ?? []).map(binding => Number(binding.HostPort))]));
  const publishedPorts = Object.values(bindings).flat();
  if (publishedPorts.some(p => !Number.isSafeInteger(p) || p < 1 || p > 65535)) throw new SiloError("ENGINE_UNAVAILABLE: invalid Docker publication", "ENGINE_UNAVAILABLE");
  return { receipt, publishedPorts, bindings, running: value.State?.Running ?? false };
};

/** Anonymous mount handles are audit data, never a volume deletion capability. */
const captureAnonymousVolumes = async (container: z.infer<typeof InspectSchema>, cwd: string): Promise<AnonymousVolume[]> => {
  if (!container.HostConfig || !container.Mounts) throw new SiloError("ENGINE_UNAVAILABLE: missing container mount provenance", "ENGINE_UNAVAILABLE");
  const host = container.HostConfig;
  const volumes: AnonymousVolume[] = [];
  for (const mount of container.Mounts.filter(m => m.Type === "volume")) {
    const supplied = host.Mounts?.some(m => m.Target === mount.Destination && m.Source) ||
      host.Binds?.some(bind => {
        const parts = bind.split(":");
        return parts.length > 1 && parts[1] === mount.Destination;
      });
    if (supplied) continue;
    if (host.VolumesFrom?.length) throw new SiloError("CLEANUP_REQUIRED: inherited volume provenance is ambiguous; removing this container with volumes could delete inherited data. No deletion permitted.", "CLEANUP_REQUIRED");
    if (!mount.Name) throw new SiloError("ENGINE_UNAVAILABLE: missing volume mount name", "ENGINE_UNAVAILABLE");
    const volume = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", "volume", "inspect", mount.Name], cwd)))[0]!;
    if (volume.Name !== mount.Name || !volume.CreatedAt || !Object.hasOwn(volume.Labels ?? {}, "com.docker.volume.anonymous")) {
      throw new SiloError(`CLEANUP_REQUIRED: cannot prove anonymous mount origin for ${mount.Name}`, "CLEANUP_REQUIRED");
    }
    volumes.push({ name: volume.Name, createdAt: volume.CreatedAt, destination: mount.Destination });
  }
  return volumes.sort((a, b) => a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0);
};

const sameObject = (a: BackendReceipt, b: BackendReceipt): boolean => a.kind === b.kind && a.name === b.name && a.id === b.id && a.createdAt === b.createdAt;

const conflict = (entry: NamespaceEntry): never => {
  throw new SiloError(`NAME_CONFLICT: existing ${entry.kind} '${entry.name}' has no matching ownership receipt. Inspect with docker ${entry.kind} inspect ${entry.id}; silo will not reuse or delete it.`, "NAME_CONFLICT", { details: { kind: entry.kind, name: entry.name, id: entry.id } });
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
    if (!sameObject(prior, current.receipt)) conflict(entry);
  }
};

/** Records only this generation's creation results, with its declared namespace and provenance. */
export const captureOwnedResources = async (owner: ProjectOperation, source: BackendReceipt["source"], creation: Extract<Launch, { phase: "exited" }>): Promise<BackendReceipt[]> => {
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
  const captured: BackendReceipt[] = [];
  for (const entry of entries) {
    const existing = prior.find(r => r.kind === entry.kind && r.name === entry.name);
    const current = await inspectObject(entry, existing?.source ?? source, owner.root);
    if (existing) {
      if (!sameObject(existing, current.receipt)) conflict(entry);
      validatePublications(current);
      captured.push(current.receipt);
      continue;
    }
    const labels = current.receipt.labels;
    const projectLabel = labels["io.silo.project"] === owner.projectId && labels["io.silo.generation"] === String(owner.generation);
    const registryFromCompletedCreate = source === "k3d" && creation.exitCode === 0 &&
      entry.kind === "container" && entry.name === registry &&
      labels["k3d.cluster"] === allocation.state.identity.k3dClusterName;
    const composeRoot = labels["com.docker.compose.project.working_dir"];
    const composeFromOwnedLaunch = source === "compose" && entry.kind === "container" &&
      labels["com.docker.compose.project"] === allocation.state.identity.composeName && composeRoot !== undefined &&
      realpathSync(composeRoot) === owner.root && creation.started && (creation.effect === "workload" || creation.effect === "hook");
    if (!projectLabel && !registryFromCompletedCreate && !composeFromOwnedLaunch) conflict(entry);
    validatePublications(current);
    captured.push(current.receipt);
  }
  owner.recordResources(captured);
  return captured;
};

/** Seals finished producers' recording before any cleanup effect can begin. */
export const captureFinishedComposeProducers = async (owner: ProjectOperation): Promise<void> => {
  const pending = owner.launches().filter((launch): launch is Extract<Launch, { phase: "exited" }> =>
    launch.phase === "exited" && launch.started && !launch.reconciled && (launch.effect === "workload" || launch.effect === "hook"));
  if (pending.length === 0) return;
  for (const launch of pending) owner.markLaunchTerminal(launch.id);
  await captureOwnedResources(owner, "compose", pending[0]!);
  for (const launch of pending) owner.checkpointLaunch({ ...launch, terminal: true, reconciled: true });
};

/** Revalidates exact IDs and creation identities before any deletion capability is used. */
export const verifyResource = async (owner: ProjectOperation, receipt: BackendReceipt): Promise<boolean> => {
  await assertEngine(owner);
  const entries = await enumerate(owner.root);
  const entry = entries.find(e => e.kind === receipt.kind && (receipt.kind === "volume" ? e.name === receipt.name : e.id === receipt.id));
  if (!entry) return false;
  const current = await inspectObject(entry, receipt.source, owner.root);
  if (!sameObject(receipt, current.receipt)) conflict(entry);
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
    throw new SiloError(`CLEANUP_REQUIRED: leaked anonymous volumes remain (${leaks.map(v => `${v.name} from ${v.parentId}`).join(", ")}). Silo never deletes volumes by name; resolve this data with its owner. Claims retained.`, "CLEANUP_REQUIRED", {
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
