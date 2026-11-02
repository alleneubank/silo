import path from "path";
import os from "os";
import crypto from "crypto";
import { promises as fs } from "fs";
import { z } from "zod";
import { SiloError } from "../utils/errors";

// Machine-wide registry of silo reservations. Readers never retire a peer's
// reservation: only its owner knows when listeners and resources are gone.
// Each project gets a single file keyed on the SHA-256 of its canonical
// (realpath-resolved) absolute project root, so names can repeat across
// projects without colliding AND the same physical repo opened via a
// symlinked path gets a single entry. The registry guarantees disjoint
// ports across serialized allocations. Concurrent allocators, including older
// silo versions, still require external serialization of read/allocate/write.

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), ".silo", "instances");
const MAX_REGISTRY_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 1024 * 1024;

const PortRegistryEntrySchema = z.object({
  projectRoot: z.string().min(1).max(4096).refine(path.isAbsolute),
  name: z.string().max(256),
  ports: z.array(z.number().int().min(1).max(65535)).max(65535),
  createdAt: z.string().max(128),
});

type PortRegistryEntry = z.infer<typeof PortRegistryEntrySchema>;

const resolveRegistryDir = (): string =>
  process.env.SILO_PORT_REGISTRY_DIR ?? DEFAULT_REGISTRY_DIR;

const registryError = (target: string, error: unknown): SiloError =>
  new SiloError(
    `Cannot determine port reservations at ${target}; allocation refused: ${error instanceof Error ? error.message : String(error)}`,
    "PORT_REGISTRY_UNAVAILABLE",
    { cause: error }
  );

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

// An uncertain canonical key cannot authorize excluding or removing an entry.
const canonicalizeProjectRoot = async (projectRoot: string): Promise<string> => {
  try {
    return await fs.realpath(projectRoot);
  } catch (error) {
    throw registryError(projectRoot, error);
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

const checkPeerLockfile = async (entry: PortRegistryEntry): Promise<void> => {
  const lockfilePath = path.join(entry.projectRoot, ".silo.lock");
  try {
    const stat = await fs.stat(lockfilePath);
    if (!stat.isFile()) {
      throw new Error("Lockfile is not a regular file");
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw registryError(lockfilePath, error);
    }
    // A missing lockfile does not prove that the reservation is safe to reuse.
    // Keep these ports excluded until the owner explicitly unregisters them.
  }
};

const readEntry = async (filePath: string): Promise<PortRegistryEntry> => {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) {
      throw new Error(`Expected a registry file no larger than ${MAX_ENTRY_BYTES} bytes`);
    }
    const raw = await fs.readFile(filePath, "utf8");
    return PortRegistryEntrySchema.parse(JSON.parse(raw));
  } catch (error) {
    throw registryError(filePath, error);
  }
};

// Read-only: an unreadable or uncertain peer must never become a free port.
export const readPeerPorts = async (params: {
  excludeProjectRoot: string;
  registryDir?: string;
}): Promise<Set<number>> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  const excluded = new Set<number>();

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) {
      return excluded;
    }
    throw registryError(dir, error);
  }
  if (files.length > MAX_REGISTRY_ENTRIES) {
    throw registryError(dir, new Error(`Registry exceeds ${MAX_REGISTRY_ENTRIES} entries`));
  }

  const ourCanonical = await canonicalizeProjectRoot(params.excludeProjectRoot);
  const ourKey = registryKey(ourCanonical);

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    if (file === `${ourKey}.json`) {
      continue;
    }
    const entry = await readEntry(path.join(dir, file));
    await checkPeerLockfile(entry);
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
  const entry = PortRegistryEntrySchema.parse({
    projectRoot: canonical,
    name: params.name,
    ports: [...params.ports].sort((a, b) => a - b),
    createdAt: new Date().toISOString(),
  });
  const destination = entryPath(canonical, dir);
  const temporary = path.join(dir, `.${registryKey(canonical)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(entry, null, 2), { flag: "wx" });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

export const unregisterInstance = async (params: {
  projectRoot: string;
  registryDir?: string;
}): Promise<void> => {
  const dir = params.registryDir ?? resolveRegistryDir();
  const canonical = await canonicalizeProjectRoot(params.projectRoot);
  await fs.rm(entryPath(canonical, dir), { force: true });
};
