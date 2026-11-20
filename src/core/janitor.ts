import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import macosArm64 from "../../vendor/janitor/macos-arm64/janitor" with { type: "file" };
import macosX8664 from "../../vendor/janitor/macos-x86_64/janitor" with { type: "file" };
import linuxAarch64 from "../../vendor/janitor/linux-aarch64/janitor" with { type: "file" };
import linuxX8664 from "../../vendor/janitor/linux-x86_64/janitor" with { type: "file" };
import { accountHome } from "./allocation_domain";
import { JANITOR_ARTIFACTS, JANITOR_PLATFORMS, JANITOR_VERSION, type JanitorPlatform } from "./janitor_release";
import { SiloError } from "../utils/errors";

const ASSETS: Readonly<Record<JanitorPlatform, string>> = {
  "macos-arm64": macosArm64,
  "macos-x86_64": macosX8664,
  "linux-aarch64": linuxAarch64,
  "linux-x86_64": linuxX8664,
};

/** Janitor's release names, keyed by Node's `${platform}-${arch}`. */
const HOST_PLATFORMS: Readonly<Record<string, JanitorPlatform>> = {
  "darwin-arm64": "macos-arm64",
  "darwin-x64": "macos-x86_64",
  "linux-arm64": "linux-aarch64",
  "linux-x64": "linux-x86_64",
};

export const janitorPlatform = (platform: NodeJS.Platform, arch: NodeJS.Architecture): JanitorPlatform | null =>
  HOST_PLATFORMS[`${platform}-${arch}`] ?? null;

/**
 * A bundled build (`bun build --target=bun`) leaves the asset path relative to
 * the bundle's directory; source and standalone builds give an absolute path
 * (standalone ones under /$bunfs, readable but not executable).
 */
const assetPath = (asset: string): string => path.isAbsolute(asset) ? asset : path.join(import.meta.dir, asset);

const launchFailed = (message: string, cause?: unknown): SiloError =>
  new SiloError(`LAUNCH_FAILED: ${message}`, "LAUNCH_FAILED", cause === undefined ? undefined : { cause });

/** The size of an existing file, or null when there is none. */
const sizeOf = (file: string): number | null => {
  try { return statSync(file).size; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw launchFailed(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, error);
  }
};

const writeDurably = (file: string, bytes: Uint8Array): void => {
  const fd = openSync(file, "wx", 0o755);
  try {
    for (let written = 0; written < bytes.byteLength;) written += writeSync(fd, bytes, written);
    fsyncSync(fd);
  } finally { closeSync(fd); }
};

/**
 * Copies the platform's embedded Janitor to an executable file keyed by its
 * digest, once per account and Janitor build. The file is synced before the
 * rename publishes it, so concurrent first launches each install the same
 * complete bytes. A copy whose size differs from the embedded binary (one cut
 * short by a crash, for example) is replaced.
 */
export const installJanitor = (platform: JanitorPlatform, home: string, asset = assetPath(ASSETS[platform])): string => {
  const { binarySha256 } = JANITOR_ARTIFACTS[platform];
  const target = path.join(home, ".silo", "janitor", `${JANITOR_VERSION}-${binarySha256.slice(0, 12)}`, "janitor");
  if (sizeOf(target) === statSync(asset).size) return target;
  const bytes = readFileSync(asset);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (digest !== binarySha256) throw launchFailed(`bundled Janitor ${JANITOR_VERSION} for ${platform} has SHA-256 ${digest}, expected ${binarySha256}; reinstall silo`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeDurably(temporary, bytes);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw launchFailed(`cannot install Janitor at ${target}: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  return target;
};

/**
 * The Janitor binary silo launches: `SILO_JANITOR` when set, otherwise the
 * one bundled with silo. `PATH` is never searched.
 */
export const janitorBinary = (env: Readonly<Record<string, string | undefined>>): string => {
  const override = env.SILO_JANITOR;
  if (override !== undefined && override !== "") return override;
  const platform = janitorPlatform(process.platform, process.arch);
  if (platform === null) throw launchFailed(`silo bundles Janitor for ${JANITOR_PLATFORMS.join(", ")}, not ${process.platform}-${process.arch}; set SILO_JANITOR to a Janitor ${JANITOR_VERSION} binary`);
  return installJanitor(platform, accountHome());
};
