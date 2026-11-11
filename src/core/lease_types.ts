import { z } from "zod";
import { FileTargetSchema } from "./file_target";

const PortsSchema = z.record(z.number().int().min(1).max(65535));
export const InstanceStateSchema = z.object({
  name: z.string().min(1).max(63),
  profile: z.string().optional(),
  ports: PortsSchema,
  identity: z.object({
    name: z.string(), prefix: z.string(), composeName: z.string(),
    dockerNetwork: z.string(), volumePrefix: z.string(), containerPrefix: z.string(),
    hosts: z.record(z.string()), k3dClusterName: z.string().optional(),
    k3dRegistryName: z.string().optional(), kubeconfigPath: z.string().optional(),
  }),
  createdAt: z.string(),
  k3dClusterCreated: z.boolean(),
  tiltPid: z.number().int().positive().optional(),
  tiltStartedAt: z.string().optional(),
});

export const AllocationSchema = z.object({
  state: InstanceStateSchema,
  configPath: z.string(), configSource: z.string().max(1024 * 1024), fingerprint: z.string(),
  urls: z.record(z.string()), k3dArgs: z.array(z.string()).max(1024),
  hostOrder: z.array(z.string()), portOrder: z.array(z.string()), urlOrder: z.array(z.string()),
  engine: z.object({ endpoint: z.string(), id: z.string() }).nullable(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const FileReceiptSchema = z.object({
  role: z.enum(["env", "lock", "kubeconfig", "config"]),
  target: FileTargetSchema,
  published: z.object({ identity: z.string(), hash: z.string(), generation: z.number().int().positive() }).nullable(),
  pending: z.discriminatedUnion("action", [
    z.object({ action: z.literal("publish"), temporary: z.string(), identity: z.string(), hash: z.string() }),
    z.object({ action: z.literal("delete") }),
  ]).nullable(),
});
export type FileReceipt = z.infer<typeof FileReceiptSchema>;

const DockerObjectIdSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<"DockerObjectId">();
const BackendIdentitySchema = z.object({
  source: z.enum(["k3d", "compose"]), name: z.string(), id: z.string(),
  createdAt: z.string(), labels: z.record(z.string()),
});
const ObservedVolumeSchema = BackendIdentitySchema.extend({ kind: z.literal("volume"), authority: z.literal("observed") });
export const OwnedImageCacheSchema = BackendIdentitySchema.extend({
  kind: z.literal("volume"), source: z.literal("k3d"), authority: z.literal("owned-image-cache"),
  purpose: z.literal("k3d-image-cache"), creationToken: z.string().uuid(),
  projectId: z.string(), generation: z.number().int().positive(), cluster: z.string().min(1),
  engine: z.object({ endpoint: z.string(), id: z.string() }),
});
export type OwnedImageCache = z.infer<typeof OwnedImageCacheSchema>;
const AnonymousVolumeSchema = z.object({
  name: z.string().min(1), createdAt: z.string().min(1), destination: z.string().min(1),
});
export type AnonymousVolume = z.infer<typeof AnonymousVolumeSchema>;
export const ObservedBackendReceiptSchema = z.discriminatedUnion("kind", [
  BackendIdentitySchema.extend({ kind: z.literal("container"), id: DockerObjectIdSchema, anonymousVolumes: z.array(AnonymousVolumeSchema).max(256) }),
  BackendIdentitySchema.extend({ kind: z.literal("network"), id: DockerObjectIdSchema }),
  ObservedVolumeSchema,
]);
export type ObservedBackendReceipt = z.infer<typeof ObservedBackendReceiptSchema>;
export const BackendReceiptSchema = z.union([ObservedBackendReceiptSchema, OwnedImageCacheSchema]);
export type BackendReceipt = z.infer<typeof BackendReceiptSchema>;

export const isOwnedImageCache = (receipt: BackendReceipt): receipt is OwnedImageCache =>
  receipt.kind === "volume" && receipt.authority === "owned-image-cache";

/** Canonical identity, independent of object-key order and launch compaction. */
export const resourceReceiptKey = (receipt: BackendReceipt): string => isOwnedImageCache(receipt)
  ? JSON.stringify([receipt.authority, receipt.purpose, receipt.kind, receipt.source, receipt.name, receipt.id,
    receipt.createdAt, receipt.creationToken, receipt.projectId, receipt.generation, receipt.cluster,
    receipt.engine.endpoint, receipt.engine.id, Object.entries(receipt.labels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])
  : JSON.stringify([receipt.kind, receipt.id, receipt.createdAt]);

/** Observing an object can confirm an owned receipt, but cannot create one. */
export const matchesResource = (receipt: BackendReceipt, observed: ObservedBackendReceipt): boolean => {
  if (receipt.kind !== observed.kind || receipt.name !== observed.name || receipt.id !== observed.id || receipt.createdAt !== observed.createdAt) return false;
  return !isOwnedImageCache(receipt) || Object.entries(receipt.labels).every(([key, value]) => observed.labels[key] === value);
};

const DockerDeletionTargetSchema = z.object({ kind: z.enum(["container", "network"]), id: DockerObjectIdSchema });
export type DockerDeletionTarget = z.infer<typeof DockerDeletionTargetSchema>;
const CacheDeletionTargetSchema = z.object({ kind: z.literal("image-cache"), receiptKey: z.string(), receipt: OwnedImageCacheSchema });
const DeletionTargetSchema = z.union([DockerDeletionTargetSchema, CacheDeletionTargetSchema]);

const LaunchBaseSchema = z.object({
  id: z.string(), kind: z.string(), command: z.array(z.string()).max(1024),
  effect: z.enum(["none", "workload", "create", "delete", "hook"]),
  deletionTarget: DeletionTargetSchema.optional(),
  cacheCreation: z.object({ token: z.string().uuid(), cluster: z.string(), name: z.string() }).optional(),
});
const UnlaunchedSchema = LaunchBaseSchema.extend({
  supervisorPid: z.null(), leaderPid: z.null(), groupId: z.null(), supervisorIdentity: z.null(), exitCode: z.null(),
});
const ExecutorSchema = LaunchBaseSchema.extend({
  supervisorPid: z.number().int().min(2), leaderPid: z.number().int().min(2),
  groupId: z.number().int().min(2), supervisorIdentity: z.string().min(1),
});
export const LaunchSchema = z.discriminatedUnion("phase", [
  UnlaunchedSchema.extend({ phase: z.literal("planned"), reconciled: z.literal(false), terminal: z.literal(false) }),
  UnlaunchedSchema.extend({ phase: z.literal("cancelled"), reconciled: z.literal(true), terminal: z.literal(true) }),
  ExecutorSchema.extend({ phase: z.literal("granted"), exitCode: z.null(), reconciled: z.literal(false), terminal: z.boolean() }),
  ExecutorSchema.extend({ phase: z.literal("exited"), started: z.boolean(), exitCode: z.number().int().nullable(), reconciled: z.boolean(), terminal: z.boolean() }),
  ExecutorSchema.extend({ phase: z.literal("resolved"), effect: z.literal("delete"), deletionTarget: DeletionTargetSchema,
    resolution: z.literal("target-absent"), exitCode: z.null(), reconciled: z.literal(true), terminal: z.literal(true) }),
]);
export type Launch = z.infer<typeof LaunchSchema>;

export const ExecutorCompletionSchema = z.object({
  projectId: z.string(), generation: z.number().int().positive(), launchId: z.string(),
  leaderPid: z.number().int().min(2), groupId: z.number().int().min(2),
  started: z.boolean(), exitCode: z.number().int(), completedAt: z.string(),
});
export type ExecutorCompletion = z.infer<typeof ExecutorCompletionSchema>;
export type ExecutorContext = Pick<ExecutorCompletion, "projectId" | "generation" | "launchId" | "leaderPid" | "groupId"> & { root: string };

export type Claim = { domain: string; resource: string; prefix?: boolean };
export type LifecyclePhase = "reserved" | "running" | "stopped" | "retained" | "cleanup-required";
