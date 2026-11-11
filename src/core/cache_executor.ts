import { assertCacheUnreferenced, captureEngine, enumerate, inspectObject } from "../backends/docker";
import { SiloError } from "../utils/errors";
import { ProjectOperation } from "./lease_store";
import { matchesResource, type ExecutorContext, type Launch, type OwnedImageCache } from "./lease_types";

/** The executing group independently reads store authority; the parent cannot vouch for it. */
export const prepareCacheRemoval = async (context: ExecutorContext, grant: Extract<Launch, { phase: "granted" }>, journal: "account" | "parent"): Promise<OwnedImageCache> => {
  if (journal !== "account") throw new SiloError("CLEANUP_REQUIRED: cache deletion requires the canonical account journal", "CLEANUP_REQUIRED");
  const receipt = await ProjectOperation.executorImageCache(context, grant);
  const engine = await captureEngine(context);
  if (engine.id !== receipt.engine.id || engine.endpoint !== receipt.engine.endpoint) throw new SiloError("CLEANUP_REQUIRED: ENGINE_CHANGED: cache engine differs from its receipt", "CLEANUP_REQUIRED");
  const entries = await enumerate(context);
  await assertCacheUnreferenced(entries, receipt.name, context);
  const current = await ProjectOperation.executorImageCache(context, grant);
  const observed = await inspectObject({ kind: "volume", name: current.name, id: current.id }, "k3d", context);
  if (!matchesResource(current, observed.receipt)) throw new SiloError(`CLEANUP_REQUIRED: final cache identity differs: ${current.name}`, "CLEANUP_REQUIRED");
  return current;
};
