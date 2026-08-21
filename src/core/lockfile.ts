import path from "path";
import { z } from "zod";
import { LOCKFILE_NAME } from "./constants";
import type { InstanceState, Lockfile } from "./types";
import { SiloError } from "../utils/errors";

const PortsSchema = z.record(z.number().int().min(1).max(65535));

const IdentitySchema = z.object({
  name: z.string(),
  prefix: z.string(),
  composeName: z.string(),
  dockerNetwork: z.string(),
  volumePrefix: z.string(),
  containerPrefix: z.string(),
  hosts: z.record(z.string()),
  k3dClusterName: z.string().optional(),
  k3dRegistryName: z.string().optional(),
  kubeconfigPath: z.string().optional(),
});

const DisownedTiltSchema = z.object({
  pid: z.number().int(),
  name: z.string(),
  ports: PortsSchema,
  startedAt: z.string().optional(),
  disownedAt: z.string(),
});

const InstanceStateSchema = z.object({
  name: z.string(),
  profile: z.string().optional(),
  ports: PortsSchema,
  identity: IdentitySchema,
  createdAt: z.string(),
  k3dClusterCreated: z.boolean(),
  tiltPid: z.number().int().optional(),
  tiltStartedAt: z.string().optional(),
  disownedTilts: z.array(DisownedTiltSchema).optional(),
});

const LockfileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  instance: InstanceStateSchema,
});

export const resolveLockfilePath = (projectRoot: string): string =>
  path.resolve(projectRoot, LOCKFILE_NAME);

export const lockfileExists = async (projectRoot: string): Promise<boolean> => {
  const file = Bun.file(resolveLockfilePath(projectRoot));
  return await file.exists();
};

export const readLockfile = async (projectRoot: string): Promise<Lockfile | null> => {
  const lockPath = resolveLockfilePath(projectRoot);
  const file = Bun.file(lockPath);
  if (!(await file.exists())) {
    return null;
  }

  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;
  return LockfileSchema.parse(parsed);
};

export const writeLockfile = async (
  projectRoot: string,
  instance: InstanceState
): Promise<void> => {
  const lockfile: Lockfile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    instance,
  };

  const lockPath = resolveLockfilePath(projectRoot);
  await Bun.write(lockPath, JSON.stringify(lockfile, null, 2));
};

export const updateLockfile = async (
  projectRoot: string,
  updater: (current: Lockfile) => InstanceState
): Promise<void> => {
  const existing = await readLockfile(projectRoot);
  if (!existing) {
    throw new SiloError("Lockfile missing", "LOCKFILE_MISSING");
  }

  const nextInstance = updater(existing);
  await writeLockfile(projectRoot, nextInstance);
};
