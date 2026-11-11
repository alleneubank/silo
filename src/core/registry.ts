import { buildTemplateVars } from "./variables";
import type { InstanceState, ResolvedConfig } from "./types";
import { interpolateTemplate } from "./interpolate";
import { SiloError } from "../utils/errors";

type RegistryAdvertiseSettings = {
  source: "k3d" | "external";
  host: string;
  hostFromContainerRuntime?: string;
  hostFromClusterNetwork?: string;
  help?: string;
};

const resolveTemplateValue = (
  value: string | undefined,
  vars: Record<string, string | number>
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const resolved = interpolateTemplate(value, vars).trim();
  return resolved.length > 0 ? resolved : undefined;
};

const validateK3dRegistryHostOverride = (params: {
  field: "hostFromContainerRuntime" | "hostFromClusterNetwork";
  value: string;
  expected: string;
}): void => {
  const { field, value, expected } = params;
  if (value === expected) {
    return;
  }

  throw new SiloError(
    `k3d.registry.${field} resolves to '${value}', but k3d registry host is '${expected}'. Use \${K3D_CLUSTER_NAME}-registry.localhost:5000 or leave it unset.`,
    "INVALID_CONFIG"
  );
};

const buildK3dRegistryDefaults = (state: InstanceState): RegistryAdvertiseSettings => {
  const registryPort = state.ports.K3D_REGISTRY_PORT;
  if (!registryPort) {
    throw new SiloError(
      "K3D_REGISTRY_PORT missing for registry advertisement",
      "INVALID_STATE"
    );
  }
  const registryHost = state.identity.k3dRegistryName?.split(":")[0];
  if (!registryHost) {
    throw new SiloError("K3D_REGISTRY_NAME missing for registry advertisement", "INVALID_STATE");
  }
  const internalHost = `${registryHost}:5000`;
  return {
    source: "k3d",
    host: `localhost:${registryPort}`,
    hostFromContainerRuntime: internalHost,
    hostFromClusterNetwork: internalHost,
  };
};

export const resolveRegistryAdvertiseSettings = (params: {
  config: ResolvedConfig;
  state: InstanceState;
  urls: Record<string, string>;
}): RegistryAdvertiseSettings | null => {
  const { config, state, urls } = params;
  const vars = buildTemplateVars({ identity: state.identity, ports: state.ports, urls });

  const k3dRegistry = config.k3d?.registry;
  if (k3dRegistry?.enabled && k3dRegistry.advertise !== false) {
    const defaults = buildK3dRegistryDefaults(state);
    if (!defaults.hostFromContainerRuntime || !defaults.hostFromClusterNetwork) {
      throw new SiloError(
        "K3D registry defaults missing for hostFrom validation",
        "INVALID_STATE"
      );
    }
    const hostFromContainerRuntime =
      resolveTemplateValue(k3dRegistry.hostFromContainerRuntime, vars) ??
      defaults.hostFromContainerRuntime;
    const hostFromClusterNetwork =
      resolveTemplateValue(k3dRegistry.hostFromClusterNetwork, vars) ??
      defaults.hostFromClusterNetwork;
    validateK3dRegistryHostOverride({
      field: "hostFromContainerRuntime",
      value: hostFromContainerRuntime,
      expected: defaults.hostFromContainerRuntime,
    });
    validateK3dRegistryHostOverride({
      field: "hostFromClusterNetwork",
      value: hostFromClusterNetwork,
      expected: defaults.hostFromClusterNetwork,
    });
    const help = resolveTemplateValue(k3dRegistry.help, vars);
    return {
      source: "k3d",
      host: resolveTemplateValue(k3dRegistry.host, vars) ?? defaults.host,
      ...(hostFromContainerRuntime !== undefined && { hostFromContainerRuntime }),
      ...(hostFromClusterNetwork !== undefined && { hostFromClusterNetwork }),
      ...(help !== undefined && { help }),
    };
  }

  const registry = config.registry;
  if (!registry || registry.advertise === false) {
    return null;
  }

  const host = resolveTemplateValue(registry.host, vars);
  if (!host) {
    throw new SiloError(
      "registry.host must be set when registry advertisement is enabled",
      "INVALID_CONFIG"
    );
  }

  const externalHostFromContainerRuntime = resolveTemplateValue(
    registry.hostFromContainerRuntime,
    vars
  );
  const externalHostFromClusterNetwork = resolveTemplateValue(
    registry.hostFromClusterNetwork,
    vars
  );
  const externalHelp = resolveTemplateValue(registry.help, vars);

  return {
    source: "external",
    host,
    ...(externalHostFromContainerRuntime !== undefined && {
      hostFromContainerRuntime: externalHostFromContainerRuntime,
    }),
    ...(externalHostFromClusterNetwork !== undefined && {
      hostFromClusterNetwork: externalHostFromClusterNetwork,
    }),
    ...(externalHelp !== undefined && { help: externalHelp }),
  };
};
