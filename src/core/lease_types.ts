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
const DockerDeletionTargetSchema = z.object({ kind: z.enum(["container", "network"]), id: DockerObjectIdSchema });
export type DockerDeletionTarget = z.infer<typeof DockerDeletionTargetSchema>;

const LaunchBaseSchema = z.object({
  id: z.string(), kind: z.string(), command: z.array(z.string()).max(1024),
  effect: z.enum(["none", "workload", "create", "delete", "hook"]),
  deletionTarget: DockerDeletionTargetSchema.optional(),
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
  ExecutorSchema.extend({ phase: z.literal("resolved"), effect: z.literal("delete"), deletionTarget: DockerDeletionTargetSchema,
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

const AnonymousVolumeSchema = z.object({
  name: z.string().min(1), createdAt: z.string().min(1), destination: z.string().min(1),
});
export type AnonymousVolume = z.infer<typeof AnonymousVolumeSchema>;
const BackendIdentitySchema = z.object({
  source: z.enum(["k3d", "compose"]),
  name: z.string(), id: z.string(),
  createdAt: z.string(), labels: z.record(z.string()),
});
export const BackendReceiptSchema = z.discriminatedUnion("kind", [
  BackendIdentitySchema.extend({ kind: z.literal("container"), id: DockerObjectIdSchema, anonymousVolumes: z.array(AnonymousVolumeSchema).max(256) }),
  BackendIdentitySchema.extend({ kind: z.literal("network"), id: DockerObjectIdSchema }),
  BackendIdentitySchema.extend({ kind: z.literal("volume") }),
]);
export type BackendReceipt = z.infer<typeof BackendReceiptSchema>;

export type Claim = { domain: string; resource: string; prefix?: boolean };
export type LifecyclePhase = "reserved" | "running" | "stopped" | "retained" | "cleanup-required";
