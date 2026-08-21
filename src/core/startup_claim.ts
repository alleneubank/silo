import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { z } from "zod";
import { STARTUP_CLAIM_NAME, STARTUP_CLAIM_TTL_MS } from "./constants";
import { isPidRunning } from "../utils/process";
import { SiloError } from "../utils/errors";
import { logger } from "../utils/logger";

const ClaimSchema = z.object({
  pid: z.number().int(),
  nonce: z.string(),
  claimedAt: z.string(),
});

type Claim = z.infer<typeof ClaimSchema>;

const claimPath = (projectRoot: string): string =>
  path.resolve(projectRoot, STARTUP_CLAIM_NAME);

const readClaim = async (file: string): Promise<Claim | null> => {
  try {
    return ClaimSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    // Missing, half-written, or malformed. Treat as abandoned rather than
    // wedging every future `silo up` on a file nobody can interpret.
    return null;
  }
};

/**
 * True when the claim's owner is gone.
 *
 * The pid is the real signal: a startup lives exactly as long as the process
 * holding it, and hooks plus k3d creation can legitimately run for a long time.
 * The age bound only exists so a claim whose pid was recycled by an unrelated
 * process eventually resolves itself.
 */
const isStale = (claim: Claim | null, now: number): boolean => {
  if (!claim) {
    return true;
  }
  if (!isPidRunning(claim.pid)) {
    return true;
  }
  const claimedAt = Date.parse(claim.claimedAt);
  return Number.isNaN(claimedAt) || now - claimedAt > STARTUP_CLAIM_TTL_MS;
};

const inProgress = (claim: Claim | null): SiloError =>
  new SiloError(
    `Another 'silo up' is starting this project${claim ? ` (pid ${claim.pid})` : ""}. Wait for it to finish.`,
    "STARTUP_IN_PROGRESS"
  );

const createExclusive = async (file: string, claim: Claim): Promise<boolean> => {
  let handle;
  try {
    handle = await fs.open(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(claim));
  } finally {
    await handle.close();
  }
  return true;
};

/**
 * Takes the claim, or throws when another live silo holds it.
 *
 * Reclaiming an abandoned claim cannot be atomic: it is a remove followed by a
 * create, and a second silo may be doing exactly the same thing. So the winner
 * is decided after the fact — whoever's nonce is in the file owns the startup,
 * and the loser backs off instead of assuming its own create survived.
 */
const acquire = async (file: string): Promise<Claim> => {
  const claim: Claim = {
    pid: process.pid,
    nonce: randomUUID(),
    claimedAt: new Date().toISOString(),
  };

  if (await createExclusive(file, claim)) {
    return claim;
  }

  const existing = await readClaim(file);
  if (!isStale(existing, Date.now())) {
    throw inProgress(existing);
  }

  logger.verbose(
    `Reclaiming abandoned startup claim${existing ? ` from pid ${existing.pid}` : ""}`
  );
  await fs.rm(file, { force: true });

  if (!(await createExclusive(file, claim))) {
    throw inProgress(await readClaim(file));
  }

  const confirmed = await readClaim(file);
  if (confirmed?.nonce !== claim.nonce) {
    throw inProgress(confirmed);
  }
  return claim;
};

/** Removes the claim only while it is still ours, never a successor's. */
const release = async (file: string, claim: Claim): Promise<void> => {
  const current = await readClaim(file);
  if (current?.nonce === claim.nonce) {
    await fs.rm(file, { force: true });
  }
};

/**
 * Runs `startup` while holding this project's exclusive startup claim.
 *
 * The lockfile's `tiltPid` only guards runs far enough apart to see each
 * other's writes; two `silo up` invocations racing through preparation would
 * both find no live Tilt and both start one. The claim covers exactly that
 * window: from the liveness check until the new pid is recorded.
 */
export const withStartupClaim = async <T>(
  projectRoot: string,
  startup: () => Promise<T>
): Promise<T> => {
  const file = claimPath(projectRoot);
  const claim = await acquire(file);

  try {
    return await startup();
  } finally {
    await release(file, claim);
  }
};
