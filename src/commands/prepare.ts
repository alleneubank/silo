import path from "node:path";
import { loadConfig } from "../core/config";
import { allocateProject, storedConfig } from "../core/allocation";
import { buildEnvVars, buildSiloProcessEnv, writeEnvAndLockfile } from "../core/env";
import { ProjectOperation } from "../core/lease_store";
import { ensureToolsAvailable } from "../utils/validate";
import { runHooks } from "../hooks/runner";
import { ensureCluster, writeKubeconfig } from "../backends/k3d";
import { advertiseLocalRegistry } from "../backends/registry";
import { assertEngine, assertNamesAvailable } from "../backends/ownership";
import { resolveRegistryAdvertiseSettings } from "../core/registry";
import { SiloError } from "../utils/errors";
import type { Allocation } from "../core/lease_types";
import type { ResolvedConfig } from "../core/types";
import { REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS, REGISTRY_ADVERTISE_RETRY_COUNT, REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS } from "../core/constants";

export const commandRoot = (config: string): string => path.dirname(path.resolve(config));

const processEnvironment = (owner: ProjectOperation): Record<string, string> => {
  const allocation = owner.current()!.allocation;
  return {
    ...buildEnvVars(allocation.state, allocation.urls),
    ...buildSiloProcessEnv({ state: allocation.state, envFilePath: owner.file("env").path, projectId: owner.projectId, generation: owner.generation }),
  };
};

export const prepareTiltEnvironment = async (owner: ProjectOperation): Promise<Record<string, string>> => {
  const current = owner.current();
  if (!current) throw new Error("Cannot launch an unallocated project");
  if (current.phase === "cleanup-required" || owner.launches().some(l => l.phase === "granted" || (l.phase === "exited" && !l.reconciled))) {
    throw new SiloError("CLEANUP_REQUIRED: reconcile this generation with down before starting again", "CLEANUP_REQUIRED");
  }
  const config = storedConfig(current.allocation);
  const tools = ["tilt", "janitor", "docker", ...(config.k3d?.enabled ? ["k3d"] : [])];
  const advertise = resolveRegistryAdvertiseSettings({ config, state: current.allocation.state, urls: current.allocation.urls });
  if (advertise) tools.push("kubectl");
  await ensureToolsAvailable(tools);
  await assertEngine(owner);
  await assertNamesAvailable(owner.resourceClaims(), owner.root, owner.resources());
  writeEnvAndLockfile(owner);
  const env = processEnvironment(owner);
  await runHooks(owner, { hooks: config.hooks["pre-up"], env, phase: "pre-up" });
  if (config.k3d?.enabled) {
    await ensureCluster(owner);
    await writeKubeconfig(owner);
  }
  if (advertise) {
    await advertiseLocalRegistry({
      owner, registryHost: advertise.host,
      ...(advertise.hostFromContainerRuntime === undefined ? {} : { registryHostFromContainerRuntime: advertise.hostFromContainerRuntime }),
      ...(advertise.hostFromClusterNetwork === undefined ? {} : { registryHostFromClusterNetwork: advertise.hostFromClusterNetwork }),
      ...(advertise.help === undefined ? {} : { help: advertise.help }),
      ...(env.KUBECONFIG === undefined ? {} : { kubeconfigPath: env.KUBECONFIG }),
      retry: { attempts: REGISTRY_ADVERTISE_RETRY_COUNT, baseDelayMs: REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS, maxDelayMs: REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS },
    });
  }
  await runHooks(owner, { hooks: config.hooks["post-up"], env, phase: "post-up" });
  writeEnvAndLockfile(owner);
  for (const role of ["env", "lock", ...(config.k3d?.enabled ? ["kubeconfig" as const] : [])] as const) owner.file(role).verify();
  return env;
};

export const withAllocation = async <T>(name: string | undefined, options: {
  config: string; force: boolean; profile: string | undefined;
  executorEntrypoint?: string;
}, run: (owner: ProjectOperation, allocation: Allocation) => Promise<T>, validateConfig?: (config: ResolvedConfig) => void): Promise<T> => {
  await loadConfig(options.config);
  const owner = await ProjectOperation.open(commandRoot(options.config), options.executorEntrypoint === undefined ? {} : { executorEntrypoint: options.executorEntrypoint });
  const initialLaunches = new Set(owner.launches().map(l => l.id));
  try {
    const allocation = await allocateProject(owner, name, options, validateConfig);
    return await run(owner, allocation);
  } catch (error) {
    const current = owner.current();
    if (current && owner.launches().some(l => !initialLaunches.has(l.id) && (l.phase === "granted" || (l.phase === "exited" && !l.reconciled)))) {
      owner.update(current.allocation, "cleanup-required", error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally { owner.finish(); }
};
