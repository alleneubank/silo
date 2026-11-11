import path from "node:path";
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import { SiloError } from "../utils/errors";
import { LOCKFILE_NAME } from "./constants";

export const ProjectRelativePathSchema = z.string().min(1).max(4096).refine(
  value => /^[A-Za-z0-9_./-]+$/.test(value) && !path.posix.isAbsolute(value) &&
    value.split("/").every(part => part.length > 0 && part !== "." && part !== ".."),
  { message: "Expected a literal project-relative file path without traversal or expansion" },
).brand<"ProjectRelativePath">();

export const FileTargetSchema = z.object({
  path: z.string(),
  base: z.string(),
  parent: z.string(),
  parentDevice: z.string(),
  parentInode: z.string(),
  key: z.string(),
});
export type FileTarget = z.infer<typeof FileTargetSchema>;
export type FileRole = "env" | "lock" | "kubeconfig" | "config";

const directoryIdentity = (directory: string): string | null => {
  try {
    const stat = statSync(directory, { bigint: true });
    return stat.isDirectory() ? `${stat.dev}/${stat.ino}` : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

const rejectControlDirectory = (directory: string, controls: readonly string[]): void => {
  for (const control of controls) {
    const identity = directoryIdentity(control);
    if (identity !== null) {
      let ancestor = directory;
      for (let depth = 0; depth < 4096; depth++) {
        if (directoryIdentity(ancestor) === identity) throw new SiloError(`PATH_CONFLICT: legacy registry is read-only: ${directory}`, "PATH_CONFLICT");
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
    }
    const parentIdentity = directoryIdentity(path.dirname(control));
    if (parentIdentity !== null && directoryIdentity(path.dirname(directory)) === parentIdentity && path.basename(directory).toLowerCase() === path.basename(control).toLowerCase()) {
      throw new SiloError(`PATH_CONFLICT: legacy registry is read-only: ${directory}`, "PATH_CONFLICT");
    }
  }
};

export const fileIdentity = (file: string): string | null => {
  let stat;
  try {
    stat = lstatSync(file, { bigint: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.nlink !== 1n) {
    throw new SiloError(`PATH_CONFLICT: expected a regular single-link file: ${file}. Inspect its owner before retrying.`, "PATH_CONFLICT");
  }
  return `${stat.dev}/${stat.ino}`;
};

/** Prepares parents non-destructively; authority is their physical identity. */
export const prepareFileTarget = (basePath: string, relativePath: string, role: FileRole | "sink", protectedDirectories: readonly string[] = []): FileTarget => {
  const relative = ProjectRelativePathSchema.parse(relativePath);
  const components = relative.split("/");
  const leaf = components.at(-1)!;
  const reserved = [LOCKFILE_NAME, ".silo.startup"];
  if (components.some(part => part.toLowerCase() === ".git") ||
    (role !== "lock" && reserved.includes(leaf.toLowerCase()))) {
    throw new SiloError(`PATH_CONFLICT: reserved control path: ${relativePath}`, "PATH_CONFLICT");
  }
  const base = realpathSync(basePath);
  rejectControlDirectory(base, protectedDirectories);
  let parent = base;
  for (const component of components.slice(0, -1)) {
    parent = path.join(parent, component);
    rejectControlDirectory(parent, protectedDirectories);
    try { mkdirSync(parent); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new SiloError(`PATH_CONFLICT: output parent is not a literal directory: ${parent}`, "PATH_CONFLICT");
    }
  }
  const physicalParent = realpathSync(parent);
  const stat = statSync(physicalParent, { bigint: true });
  return {
    path: path.join(physicalParent, leaf), base, parent: physicalParent,
    parentDevice: String(stat.dev), parentInode: String(stat.ino),
    key: `${stat.dev}/${stat.ino}/${leaf.toLowerCase()}`,
  };
};

export const verifyFileParent = (target: FileTarget): void => {
  const relative = path.relative(target.base, target.parent);
  let current = target.base;
  for (const component of relative ? relative.split(path.sep) : []) {
    current = path.join(current, component);
    const part = lstatSync(current);
    if (!part.isDirectory() || part.isSymbolicLink()) {
      throw new SiloError(`PATH_CHANGED: output parent changed: ${current}`, "PATH_CHANGED");
    }
  }
  const stat = statSync(target.parent, { bigint: true });
  if (String(stat.dev) !== target.parentDevice || String(stat.ino) !== target.parentInode) {
    throw new SiloError(`PATH_CHANGED: output parent identity changed: ${target.parent}`, "PATH_CHANGED");
  }
};
