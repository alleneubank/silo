import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { SiloError } from "../utils/errors";
import { accountHome } from "./allocation_domain";

const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 1024 * 1024;
const DisplaySchema = z.object({
  projectRoot: z.string().max(4096).optional(),
  ports: z.union([z.array(z.number()), z.record(z.number())]).optional(),
  pid: z.number().int().positive().optional(),
  tiltPid: z.number().int().positive().optional(),
}).passthrough();
const StoreMarkerSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1).max(128),
  generation: z.number().int().positive(),
});

/**
 * Whether the entry's own silo 0.x `down` can remove it: 0.x removes
 * `sha256(realpath(root)).json`, so an entry written before its root moved or
 * became a symlink, or whose root is gone, outlives every `down`.
 */
type Reach =
  | { reach: "reachable" }
  | { reach: "moved"; resolvedRoot: string }
  | { reach: "root-missing" }
  | { reach: "unresolvable"; errorCode: string };

type LegacyFinding = {
  kind: "registry" | "lock";
  path: string;
  root?: string;
  ports?: number[];
  recordedPids?: number[];
  unrecognized?: true;
} & (Reach | { reach?: never });

const defaultInputs = () => ({ accountHome: accountHome(), home: os.homedir(), registryDir: process.env.SILO_PORT_REGISTRY_DIR });

export const legacyRegistryDirectories = (inputs: {
  accountHome: string;
  home: string;
  registryDir: string | undefined;
} = defaultInputs()): string[] => [...new Set([
  ...(inputs.registryDir === undefined ? [] : [path.resolve(inputs.registryDir)]),
  path.join(inputs.accountHome, ".silo", "instances"),
  path.join(inputs.home, ".silo", "instances"),
])];

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const readDisplay = async (file: string): Promise<unknown> => {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) return null;
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const reachOf = async (file: string, root: string): Promise<Reach> => {
  let resolvedRoot: string;
  try { resolvedRoot = await fs.realpath(root); }
  catch (error) {
    // Any failure to resolve keeps the entry listed; only the listing's advice depends on why.
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    return code === "ENOENT" || code === "ENOTDIR" ? { reach: "root-missing" } : { reach: "unresolvable", errorCode: code };
  }
  const key = createHash("sha256").update(resolvedRoot).digest("hex");
  return path.basename(file) === `${key}.json` ? { reach: "reachable" } : { reach: "moved", resolvedRoot };
};

const describe = async (file: string, value: unknown): Promise<LegacyFinding> => {
  const parsed = DisplaySchema.safeParse(value);
  if (!parsed.success) return { kind: "registry", path: file, unrecognized: true };
  const { projectRoot, ports, pid, tiltPid } = parsed.data;
  const recordedPids = [pid, tiltPid].filter((p): p is number => p !== undefined);
  return {
    kind: "registry", path: file,
    ...(projectRoot === undefined ? {} : { root: projectRoot, ...await reachOf(file, projectRoot) }),
    ...(ports === undefined ? {} : { ports: Object.values(ports) }),
    ...(recordedPids.length === 0 ? {} : { recordedPids }),
  };
};

/** Read-only cutover check. A malformed or stale entry still blocks every project. */
export const findLegacyState = async (projectRoot: string, inputs = defaultInputs()): Promise<LegacyFinding[]> => {
  const found: LegacyFinding[] = [];
  try {
    for (const dir of legacyRegistryDirectories(inputs)) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (entries.length > MAX_ENTRIES) throw new Error(`Legacy directory exceeds ${MAX_ENTRIES} entries: ${dir}`);
      for (const entry of entries.sort()) {
        if (!entry.endsWith(".json")) continue;
        const file = path.join(dir, entry);
        found.push(await describe(file, await readDisplay(file)));
      }
    }
    const lockPath = path.join(projectRoot, ".silo.lock");
    let lock: unknown;
    try {
      lock = await readDisplay(lockPath);
    } catch (error) {
      if (!missing(error)) throw error;
      return found;
    }
    if (!StoreMarkerSchema.safeParse(lock).success) {
      found.push({ kind: "lock", path: lockPath, root: projectRoot, unrecognized: true });
    }
    return found;
  } catch (cause) {
    throw new SiloError("Cannot inspect legacy state; allocation refused", "LEGACY_CHECK_UNAVAILABLE", { cause });
  }
};

const nextStep = (finding: LegacyFinding, root: string): string | null => {
  if (finding.reach === undefined) return null;
  if (finding.reach === "reachable") return `stop it with that project's own silo 0.x (\`silo down --clean\` in ${root})`;
  if (finding.reach === "moved") return `its root now resolves to ${finding.resolvedRoot}, so no silo 0.x down can remove it; if nothing uses it, delete the file`;
  if (finding.reach === "unresolvable") return `its root cannot be resolved (${finding.errorCode}), so a silo 0.x down there may not remove it; if nothing uses it, delete the file`;
  return "its root no longer exists, so no silo 0.x down can remove it; if nothing uses it, delete the file";
};

const listingLine = (finding: LegacyFinding): string => {
  if (finding.root === undefined) return `  ${finding.path} (unrecognized)`;
  const recorded = [
    ...(finding.ports?.length ? [`ports ${finding.ports.join(",")}`] : []),
    ...(finding.recordedPids?.length ? [`pids ${finding.recordedPids.join(",")}`] : []),
  ];
  const facts = `root: ${finding.root}${recorded.length ? `; ${recorded.join("; ")}` : ""}`;
  const step = nextStep(finding, finding.root);
  return step === null ? `  ${finding.path} (${facts})` : `  ${finding.path} (${facts})\n    ${step}`;
};

export const assertNoLegacyState = async (projectRoot: string, inputs?: Parameters<typeof findLegacyState>[1]): Promise<void> => {
  const found = await findLegacyState(projectRoot, inputs);
  if (found.length === 0) return;
  throw new SiloError(
    `LEGACY_STATE: legacy silo state blocks this account's allocations.\n${found.map(listingLine).join("\n")}\n` +
    "Clear each entry as listed, confirm no legacy registry entries remain, then recreate projects with this silo. " +
    "Before the first allocation, announce the cutover, upgrade or retire every old invocation, and ensure all old silo operations are terminal; " +
    "a project whose silo still resolves to 0.x (check `silo version` in its root, and the host's global silo) recreates this state on its next up. " +
    "No data, ports, clusters or volumes carry over. Silo deleted nothing.",
    "LEGACY_STATE", { details: { found, changed: false, legacy: true } },
  );
};
