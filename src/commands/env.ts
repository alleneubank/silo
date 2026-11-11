import { appendGithubEnv, writeEnvAndLockfile } from "../core/env";
import { logKeyValues, logger } from "../utils/logger";
import { envDidNotStartHint } from "../utils/breadcrumbs";
import { resolveGithubEnvPath, shouldExportCiEnv } from "../utils/ci";
import { withAllocation } from "./prepare";

export const env = async (name: string | undefined, options: {
  config: string; force: boolean; profile: string | undefined; exportCi: boolean;
  executorEntrypoint?: string;
}): Promise<boolean> => {
  const sink = shouldExportCiEnv(options.exportCi) ? resolveGithubEnvPath(options.exportCi) : null;
  return await withAllocation(name, options, async (owner, allocation) => {
    const before = [owner.fileReceipt("env")?.published?.hash, owner.fileReceipt("lock")?.published?.hash];
    const file = writeEnvAndLockfile(owner);
    if (sink) appendGithubEnv(owner, sink);
    logKeyValues("Ports", allocation.state.ports);
    logKeyValues("URLs", allocation.urls);
    logger.info(`Project ${owner.projectId}, generation ${owner.generation}: reserved`);
    logger.info(envDidNotStartHint(file));
    const after = [owner.fileReceipt("env")?.published?.hash, owner.fileReceipt("lock")?.published?.hash];
    return sink !== null || before.some((hash, index) => hash !== after[index]);
  });
};
