// Downloads the pinned Janitor release into vendor/janitor/<platform>/janitor,
// checking each archive's and binary's SHA-256. Runs as the package's
// `prepare` script; a platform whose binary already matches is skipped.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JANITOR_ARTIFACTS, JANITOR_PLATFORMS, JANITOR_VERSION, janitorArchiveRoot, janitorReleaseUrl, type JanitorPlatform } from "../src/core/janitor_release";

const vendor = path.join(import.meta.dir, "..", "vendor", "janitor");
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_ATTEMPTS = 3;
const ARCHIVE_BYTES_MAX = 16 * 1024 * 1024;

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const download = async (url: string): Promise<Uint8Array> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > ARCHIVE_BYTES_MAX) throw new Error(`archive is ${bytes.byteLength} bytes, over ${ARCHIVE_BYTES_MAX}`);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) await Bun.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`download ${url} failed after ${DOWNLOAD_ATTEMPTS} attempts`, { cause: lastError });
};

/** Reads one member of a release archive with the system's tar or unzip. */
const extract = (platform: JanitorPlatform, archivePath: string, member: string): Uint8Array => {
  const entry = `${janitorArchiveRoot(platform)}/${member}`;
  const command = archivePath.endsWith(".zip") ? ["unzip", "-p", archivePath, entry] : ["tar", "-xzOf", archivePath, entry];
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  if (result.exitCode !== 0) throw new Error(`${command[0]} could not read ${entry} from ${archivePath}: ${result.stderr.toString().trim()}`);
  return new Uint8Array(result.stdout);
};

const writeAtomically = (target: string, bytes: Uint8Array, mode: number): void => {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, target);
};

const binaryPath = (platform: JanitorPlatform): string => path.join(vendor, platform, "janitor");

const current = (platform: JanitorPlatform): boolean => {
  const target = binaryPath(platform);
  return existsSync(target) && sha256(readFileSync(target)) === JANITOR_ARTIFACTS[platform].binarySha256;
};

const fetchPlatform = async (platform: JanitorPlatform, scratch: string): Promise<void> => {
  const artifact = JANITOR_ARTIFACTS[platform];
  const archive = await download(janitorReleaseUrl(platform));
  const archiveDigest = sha256(archive);
  if (archiveDigest !== artifact.archiveSha256) throw new Error(`${artifact.archive}: SHA-256 ${archiveDigest}, expected ${artifact.archiveSha256}`);
  const archivePath = path.join(scratch, artifact.archive);
  writeFileSync(archivePath, archive);
  const binary = extract(platform, archivePath, "janitor");
  const binaryDigest = sha256(binary);
  if (binaryDigest !== artifact.binarySha256) throw new Error(`${artifact.archive}: janitor SHA-256 ${binaryDigest}, expected ${artifact.binarySha256}`);
  writeAtomically(binaryPath(platform), binary, 0o755);
  writeAtomically(path.join(vendor, "LICENSE"), extract(platform, archivePath, "LICENSE"), 0o644);
};

const stale = JANITOR_PLATFORMS.filter(platform => !current(platform));
if (stale.length > 0) {
  const scratch = path.join(vendor, `.download-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  try {
    for (const platform of stale) await fetchPlatform(platform, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`janitor ${JANITOR_VERSION}: fetched ${stale.join(", ")}`);
}
