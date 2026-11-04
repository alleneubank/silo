import { buildIdentityVars, buildInstanceIdentity } from "./identity";
import { resolveHosts } from "./hosts";
import { interpolateTemplate } from "./interpolate";
import { buildEnvVars } from "./env";
import type { ResolvedConfig, InstanceState } from "./types";
import { buildTemplateVars } from "./variables";

const resolveTemplateRecord = (
  templates: Record<string, string>, order: string[], vars: Record<string, string | number>,
): Record<string, string> => Object.fromEntries(order.flatMap(key => {
  const template = templates[key];
  return template === undefined ? [] : [[key, interpolateTemplate(template, vars)]];
}));

/** Rendering is pure; only the lease constructor assigns and commits these ports. */
export const buildInstanceState = (params: {
  config: ResolvedConfig; name: string; profile: string | undefined;
  ports: Record<string, number>; createdAt?: string;
}) => {
  const { config, name, profile, ports } = params;
  const { hosts, order: hostOrder } = resolveHosts({
    templates: config.hosts, order: config.hostOrder,
    identityVars: buildIdentityVars(name, config.prefix),
  });
  const identity = buildInstanceIdentity({ name, prefix: config.prefix, hosts, ports, projectRoot: config.projectRoot, k3d: config.k3d });
  const urls = resolveTemplateRecord(config.urls, config.urlOrder, buildTemplateVars({ identity, ports }));
  const vars = buildTemplateVars({ identity, ports, urls });
  const state: InstanceState = {
    name, ...(profile ? { profile } : {}), ports, identity,
    createdAt: params.createdAt ?? new Date().toISOString(), k3dClusterCreated: false,
  };
  return {
    state, urls, envVars: buildEnvVars(state, urls), hostOrder,
    portOrder: Object.keys(ports), urlOrder: config.urlOrder,
    k3dArgs: (config.k3d?.args ?? []).map(arg => interpolateTemplate(arg, vars)),
  };
};
