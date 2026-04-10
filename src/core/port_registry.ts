import path from "path";
import os from "os";
import crypto from "crypto";
import { promises as fs } from "fs";
import { z } from "zod";

// Machine-wide registry of live silo instances and the ports they own.
// Each project gets a single file keyed on the SHA-256 of its canonical
// (realpath-resolved) absolute project root, so names can repeat across
// projects without colliding AND the same physical repo opened via a
// symlinked path gets a single entry. The registry guarantees disjoint
// ports across silo instances on the same machine — hash/ephemeral
// allocation alone cannot, because on a cold machine the free-port probe
// has nothing to detect.

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), ".silo", "instances");

const PortRegistryEntrySchema = z.object({
  // Canonical (realpath-resolved) absolute path. Used both for liveness
  // (its `.silo.lock` must still exist) and for self-comparison across
  // symlink aliases.
  projectRoot: z.string(),
  name: z.string(),
  ports: z.array(z.number().int().min(1).max(65535)),
  createdAt: z.string(),
});

type PortRegistryEntry = z.infer<typeof PortRegistryEntrySchema>;

const resolveRegistryDir = (): string =>
  process.env.SILO_PORT_REGISTRY_DIR ?? DEFAULT_REGISTRY_DIR;

// Best-effort canonicalization. `fs.realpath` resolves symlinks so the
// same physical repo opened via different alias paths hashes to the same
// key. If the path doesn't exist yet (or realpath fails for any reason),
// we fall back to the logical `path.resolve` — this is purely a
// dedup/isolation optimization and must never fail the allocation.
const canonicalizeProjectRoot = async (projectRoot: string): Promise<string> => {
  try {
    return await fs.realpath(projectRoot);
  } catch {
    return path.resolve(projectRoot);
  }
};

// Registry filename for a canonical project root. SHA-256 hex (64
// chars) — zero collision probability in practice. A truncated or
// non-cryptographic hash (e.g. 32-bit FNV) would let two real project
// paths land in the same registry file, destroying isolation (see
// review cycle 3, pair `hirjqfoz3x2c9l` / `2wblm5976j31rg` under FNV).
// EXPORTED for unit tests that pin the non-collision invariant.
export const registryKey = (canonicalProjectRoot: string): string =>
  crypto.createHash("sha256").update(canonicalProjectRoot).digest("hex");

const entryPath = (canonicalProjectRoot: string, dir: string): string =>
  path.join(dir, `${registryKey(canonicalProjectRoot)}.json`);

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

  const ourCanonical = await canonicalizeProjectRoot(params.excludeProjectRoot);
  const ourKey = registryKey(ourCanonical);

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
    // Defense-in-depth self-check: also compare by canonical path in case
    // two different filenames both point at our own project (e.g. an
    // older entry written before realpath canonicalization was added).
    const entryCanonical = await canonicalizeProjectRoot(entry.projectRoot);
    if (entryCanonical === ourCanonical) {
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
  const canonical = await canonicalizeProjectRoot(params.projectRoot);
  const entry: PortRegistryEntry = {
    projectRoot: canonical,
    name: params.name,
    ports: [...params.ports].sort((a, b) => a - b),
    createdAt: new Date().toISOString(),
  };
  await Bun.write(entryPath(canonical, dir), JSON.stringify(entry, null, 2));
};

export const unregisterInstance = async (params: {
  projectRoot: string;
  registryDir?: string;
}): Promise<void> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  const canonical = await canonicalizeProjectRoot(params.projectRoot);
  await fs.rm(entryPath(canonical, dir), { force: true });
};
