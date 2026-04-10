import path from "path";
import os from "os";
import crypto from "crypto";
import { promises as fs } from "fs";
import { z } from "zod";

// Machine-wide registry of live silo instances and the ports they own.
// Each project gets a single file keyed on a deterministic hash of its
// absolute project root so names can repeat across projects without
// colliding. The registry guarantees disjoint ports across silo instances
// on the same machine — hash/ephemeral allocation alone cannot, because on
// a cold machine the free-port probe has nothing to detect.

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), ".silo", "instances");

const PortRegistryEntrySchema = z.object({
  projectRoot: z.string(),
  name: z.string(),
  ports: z.array(z.number().int().min(1).max(65535)),
  createdAt: z.string(),
});

type PortRegistryEntry = z.infer<typeof PortRegistryEntrySchema>;

const resolveRegistryDir = (): string =>
  process.env.SILO_PORT_REGISTRY_DIR ?? DEFAULT_REGISTRY_DIR;

// SHA-256 of the absolute project root, hex-encoded. 64 chars, zero
// collision probability in practice. A truncated or non-cryptographic
// hash (e.g. 32-bit FNV) would let two real project paths land in the
// same registry file, destroying isolation — see review cycle 3.
const registryKey = (projectRoot: string): string =>
  crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex");

const entryPath = (projectRoot: string, dir: string): string =>
  path.join(dir, `${registryKey(projectRoot)}.json`);

const safeAccess = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

// An entry is considered live iff its project still has a silo lockfile.
// This ties registry liveness to the lockfile that silo itself manages,
// avoiding pid-tracking issues for `silo env`-only users (who have no
// long-lived parent process) and auto-GCing after `silo down --clean`.
const isEntryLive = async (entry: PortRegistryEntry): Promise<boolean> => {
  const lockfilePath = path.join(entry.projectRoot, ".silo.lock");
  return safeAccess(lockfilePath);
};

const readEntry = async (filePath: string): Promise<PortRegistryEntry | null> => {
  try {
    const raw = await Bun.file(filePath).text();
    return PortRegistryEntrySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

// Returns the set of ports owned by other live silo instances on this
// machine, garbage-collecting any stale entries encountered along the way.
export const readPeerPorts = async (params: {
  excludeProjectRoot: string;
  registryDir?: string;
}): Promise<Set<number>> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  const excluded = new Set<number>();

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    // Registry directory doesn't exist yet — no peers.
    return excluded;
  }

  const ourKey = registryKey(params.excludeProjectRoot);
  const ourResolvedRoot = path.resolve(params.excludeProjectRoot);

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const full = path.join(dir, file);
    const entry = await readEntry(full);
    if (!entry) {
      // Corrupt file — remove it so it stops causing read errors.
      await fs.rm(full, { force: true });
      continue;
    }
    if (file === `${ourKey}.json`) {
      continue;
    }
    if (path.resolve(entry.projectRoot) === ourResolvedRoot) {
      // Same project via a different path (symlinks etc.) — skip, not a peer.
      continue;
    }
    if (!(await isEntryLive(entry))) {
      await fs.rm(full, { force: true });
      continue;
    }
    for (const port of entry.ports) {
      excluded.add(port);
    }
  }

  return excluded;
};

export const registerInstance = async (params: {
  projectRoot: string;
  name: string;
  ports: number[];
  registryDir?: string;
}): Promise<void> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  await fs.mkdir(dir, { recursive: true });
  const entry: PortRegistryEntry = {
    projectRoot: path.resolve(params.projectRoot),
    name: params.name,
    ports: [...params.ports].sort((a, b) => a - b),
    createdAt: new Date().toISOString(),
  };
  await Bun.write(entryPath(params.projectRoot, dir), JSON.stringify(entry, null, 2));
};

export const unregisterInstance = async (params: {
  projectRoot: string;
  registryDir?: string;
}): Promise<void> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  await fs.rm(entryPath(params.projectRoot, dir), { force: true });
};
