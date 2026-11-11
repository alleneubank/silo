import { z } from "zod";
import { runCommand } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { ObservedBackendReceiptSchema } from "../core/lease_types";
import type { Allocation, AnonymousVolume, BackendReceipt, ObservedBackendReceipt } from "../core/lease_types";

export type BackendContext = { readonly root: string; readonly signal?: AbortSignal | undefined };

export const MAX_OBJECTS = 10_000;
const TOOL_TIMEOUT_MS = 5000;
const EngineSchema = z.object({ ID: z.string().min(1), OSType: z.literal("linux") });
export const ListRowSchema = z.object({ ID: z.string().optional(), Name: z.string().optional(), Names: z.string().optional() });
const LabelsSchema = z.record(z.string()).nullable().optional();
const MountSchema = z.discriminatedUnion("Type", [
  z.object({ Type: z.literal("volume"), Name: z.string().min(1), Destination: z.string().min(1) }),
  z.object({ Type: z.enum(["bind", "tmpfs"]), Destination: z.string().min(1) }),
]);
const InspectSchema = z.object({
  Id: z.string().optional(), Name: z.string(), Created: z.string().optional(), CreatedAt: z.string().optional(),
  Labels: LabelsSchema, Config: z.object({ Labels: LabelsSchema }).optional(),
  HostConfig: z.object({
    Binds: z.array(z.string()).max(256).nullable().optional(),
    Mounts: z.array(z.object({ Type: z.string(), Source: z.string().optional(), Target: z.string() })).max(256).optional(),
    VolumesFrom: z.array(z.string()).max(256).nullable().optional(),
  }).optional(),
  Mounts: z.array(MountSchema).max(256).optional(),
  State: z.object({ Running: z.boolean() }).optional(),
  NetworkSettings: z.object({ Ports: z.record(z.array(z.object({ HostPort: z.string() })).nullable()).nullable().optional() }).optional(),
});
export type NamespaceEntry = { kind: BackendReceipt["kind"]; name: string; id: string };
export type InspectedObject = { receipt: ObservedBackendReceipt; publishedPorts: number[]; bindings: Record<string, number[]>; running: boolean };
export const query = async (argv: string[], context: BackendContext): Promise<string> => {
  const result = await runCommand(argv, { cwd: context.root, ...(context.signal === undefined ? {} : { signal: context.signal }), timeoutMs: TOOL_TIMEOUT_MS, context: argv.slice(0, 3).join(" "), stdio: "pipe" });
  context.signal?.throwIfAborted();
  if (result.exitCode !== 0) throw new SiloError(`ENGINE_UNAVAILABLE: ${argv.slice(0, 3).join(" ")} failed; absence is not established`, "ENGINE_UNAVAILABLE");
  return result.stdout;
};

export const captureEngine = async (context: BackendContext): Promise<NonNullable<Allocation["engine"]>> => {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
    ? process.env.DOCKER_HOST
    : (await query(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], context)).trim();
  if (!endpoint.startsWith("unix:///") || endpoint.length > 4096) {
    throw new SiloError("ENGINE_UNSUPPORTED: silo requires a local Unix-socket Docker endpoint", "ENGINE_UNSUPPORTED");
  }
  const info = EngineSchema.parse(JSON.parse(await query(["docker", "info", "--format", "{{json .}}"], context)));
  return { endpoint, id: info.ID };
};

/** Complete structured enumeration, checked against the engine's known-present bridge. */
export const enumerate = async (context: BackendContext): Promise<NamespaceEntry[]> => {
  const entries: NamespaceEntry[] = [];
  for (const kind of ["container", "network", "volume"] as const) {
    const args = ["docker", kind, "ls", ...(kind === "container" ? ["-a"] : []), ...(kind === "volume" ? [] : ["--no-trunc"]), "--format", "{{json .}}"];
    const output = await query(args, context);
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
  const control = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", "network", "inspect", bridge.id], context)))[0]!;
  if (control.Id !== bridge.id || control.Name !== "bridge") throw new SiloError("ENGINE_UNAVAILABLE: enumeration control mismatch", "ENGINE_UNAVAILABLE");
  return entries;
};

export const inspectObject = async (entry: NamespaceEntry, source: BackendReceipt["source"], context: BackendContext): Promise<InspectedObject> => {
  const value = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", entry.kind, "inspect", entry.id], context)))[0]!;
  if (entry.kind === "container" && !value.State) throw new SiloError(`ENGINE_UNAVAILABLE: missing container state: ${entry.name}`, "ENGINE_UNAVAILABLE");
  const labels = value.Config?.Labels ?? value.Labels ?? {};
  const safeLabels = Object.fromEntries(Object.entries(labels).filter(([key]) =>
    ["io.silo.project", "io.silo.generation", "io.silo.creation", "k3d.cluster", "k3d.role", "app", "com.docker.compose.project", "com.docker.compose.project.working_dir"].includes(key),
  ));
  const createdAt = entry.kind === "volume" ? value.CreatedAt : value.Created;
  if (!createdAt) throw new SiloError(`ENGINE_UNAVAILABLE: missing resource creation identity: ${entry.name}`, "ENGINE_UNAVAILABLE");
  const identity = {
    source, name: value.Name.replace(/^\//, ""), id: entry.kind === "volume" ? value.Name : value.Id,
    createdAt, labels: safeLabels,
  };
  const receipt = ObservedBackendReceiptSchema.parse(entry.kind === "container"
    ? { ...identity, kind: "container", anonymousVolumes: await captureAnonymousVolumes(value, context) }
    : { ...identity, kind: entry.kind, ...(entry.kind === "volume" ? { authority: "observed" } : {}) });
  const bindings = Object.fromEntries(Object.entries(value.NetworkSettings?.Ports ?? {}).map(([target, bindings]) => [target, (bindings ?? []).map(binding => Number(binding.HostPort))]));
  const publishedPorts = Object.values(bindings).flat();
  if (publishedPorts.some(p => !Number.isSafeInteger(p) || p < 1 || p > 65535)) throw new SiloError("ENGINE_UNAVAILABLE: invalid Docker publication", "ENGINE_UNAVAILABLE");
  return { receipt, publishedPorts, bindings, running: value.State?.Running ?? false };
};

/** Every container state can hold a volume reference, including created and stopped. */
export const assertCacheUnreferenced = async (entries: NamespaceEntry[], name: string, context: BackendContext): Promise<void> => {
  for (const entry of entries.filter(e => e.kind === "container")) {
    const value = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", "container", "inspect", entry.id], context)))[0]!;
    if (value.Id !== entry.id || !value.Mounts) throw new SiloError(`CLEANUP_REQUIRED: incomplete mount inspection for ${entry.id}`, "CLEANUP_REQUIRED");
    for (const mount of value.Mounts) {
      if (mount.Type !== "volume") continue;
      if (mount.Name === name) throw new SiloError(`CLEANUP_REQUIRED: image cache ${name} is referenced by container ${entry.id}`, "CLEANUP_REQUIRED");
    }
  }
};

/** Anonymous mount handles are audit data, never a volume deletion capability. */
const captureAnonymousVolumes = async (container: z.infer<typeof InspectSchema>, context: BackendContext): Promise<AnonymousVolume[]> => {
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
    const volume = z.array(InspectSchema).length(1).parse(JSON.parse(await query(["docker", "volume", "inspect", mount.Name], context)))[0]!;
    if (volume.Name !== mount.Name || !volume.CreatedAt || !Object.hasOwn(volume.Labels ?? {}, "com.docker.volume.anonymous")) {
      throw new SiloError(`CLEANUP_REQUIRED: cannot prove anonymous mount origin for ${mount.Name}`, "CLEANUP_REQUIRED");
    }
    volumes.push({ name: volume.Name, createdAt: volume.CreatedAt, destination: mount.Destination });
  }
  return volumes.sort((a, b) => a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0);
};

