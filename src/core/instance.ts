import { allocatePorts, type PortAllocationEvent } from "./ports";
import { buildIdentityVars, buildInstanceIdentity } from "./identity";
import { resolveHosts } from "./hosts";
import { interpolateTemplate } from "./interpolate";
import { buildEnvVars } from "./env";
import type {
  DisownedTilt,
  Lockfile,
  ResolvedConfig,
  InstanceState,
} from "./types";
import { buildTemplateVars } from "./variables";
import { sanitizeName, generateName } from "./name";

export const resolveTemplateRecord = (
  templates: Record<string, string>,
  order: string[],
  vars: Record<string, string | number>
): Record<string, string> => {
  const resolved: Record<string, string> = {};
  order.forEach((key) => {
    const template = templates[key];
    if (template !== undefined) {
      resolved[key] = interpolateTemplate(template, vars);
    }
  });
  return resolved;
};

/**
 * URLs an instance currently answers on, resolved from its recorded identity
 * and ports rather than from a fresh allocation.
 */
export const resolveInstanceUrls = (params: {
  config: ResolvedConfig | null | undefined;
  instance: InstanceState;
}): Record<string, string> => {
  const { config, instance } = params;
  if (!config || config.urlOrder.length === 0) {
    return {};
  }
  return resolveTemplateRecord(
    config.urls,
    config.urlOrder,
    buildTemplateVars({ identity: instance.identity, ports: instance.ports })
  );
};

export const resolveInstanceName = (params: {
  nameArg: string | undefined;
  lockfile: Lockfile | null | undefined;
  projectRoot: string;
}): string => {
  const { nameArg, lockfile, projectRoot } = params;
  if (nameArg) {
    return sanitizeName(nameArg);
  }
  if (lockfile?.instance?.name) {
    return lockfile.instance.name;
  }
  return generateName(projectRoot);
};

export const buildInstanceState = async (params: {
  config: ResolvedConfig;
  name: string;
  profile: string | undefined;
  lockfile: Lockfile | null | undefined;
  force: boolean;
  // Ports owned by other live silo instances on this machine. The caller
  // should read this from the port registry before invoking; omitting it
  // loses cross-instance isolation.
  excludedPorts?: Set<number>;
  // Overrides the disowned stacks carried from the lockfile. Callers that
  // already probed liveness pass the pruned list so dead stacks are dropped.
  disownedTilts?: readonly DisownedTilt[];
  createdAt?: string;
  onPortAllocation?: (event: PortAllocationEvent) => void;
}): Promise<{
  state: InstanceState;
  urls: Record<string, string>;
  envVars: Record<string, string>;
  hostOrder: string[];
  portOrder: string[];
  urlOrder: string[];
  k3dArgs: string[];
}> => {
  const {
    config,
    name,
    profile,
    lockfile,
    force,
    excludedPorts,
    disownedTilts: disownedOverride,
    createdAt,
    onPortAllocation,
  } = params;
  const identityVars = buildIdentityVars(name, config.prefix);

  const { hosts, order: hostOrder } = resolveHosts({
    templates: config.hosts,
    order: config.hostOrder,
    identityVars,
  });

  const ports = await allocatePorts({
    ports: config.ports,
    order: config.portOrder,
    lockfilePorts: lockfile?.instance?.ports,
    force,
    ...(excludedPorts ? { excludedPorts } : {}),
    ...(onPortAllocation ? { onEvent: onPortAllocation } : {}),
  });

  const identity = buildInstanceIdentity({
    name,
    prefix: config.prefix,
    hosts,
    ports,
    k3dEnabled: config.k3d?.enabled ?? false,
    registryEnabled: config.k3d?.registry?.enabled ?? false,
  });

  const templateVars = buildTemplateVars({ identity, ports });
  const urls = resolveTemplateRecord(config.urls, config.urlOrder, templateVars);
  const templateVarsWithUrls = buildTemplateVars({ identity, ports, urls });
  const k3dArgs = config.k3d?.args
    ? config.k3d.args.map((arg) => interpolateTemplate(arg, templateVarsWithUrls))
    : [];

  // Stacks disowned by a previous `silo up --force` belong to the project, not
  // to the instance being rebuilt: dropping them here would orphan a running
  // Tilt with no record anywhere, which is the failure this list exists for.
  const disownedTilts = disownedOverride ?? lockfile?.instance?.disownedTilts;

  const state: InstanceState = {
    name,
    ...(profile ? { profile } : {}),
    ports,
    identity,
    createdAt: createdAt ?? new Date().toISOString(),
    k3dClusterCreated: false,
    ...(disownedTilts && disownedTilts.length > 0
      ? { disownedTilts: [...disownedTilts] }
      : {}),
  };

  const envVars = buildEnvVars(state, urls);

  return {
    state,
    urls,
    envVars,
    hostOrder,
    portOrder: config.portOrder,
    urlOrder: config.urlOrder,
    k3dArgs,
  };
};
