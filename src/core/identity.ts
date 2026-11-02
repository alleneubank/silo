import path from "path";
import os from "os";
import type { IdentityVars, InstanceIdentity, K3dConfig } from "./types";
import { shortenK3dClusterName } from "./name";
import { SiloError } from "../utils/errors";

export const buildIdentityVars = (name: string, prefix: string): IdentityVars => ({
  name,
  prefix,
  WORKSPACE_NAME: name,
  COMPOSE_PROJECT_NAME: `${prefix}-${name}`,
});

export const buildInstanceIdentity = (params: {
  name: string;
  prefix: string;
  hosts: Record<string, string>;
  ports: Record<string, number>;
  projectRoot: string;
  k3d: K3dConfig | undefined;
}): InstanceIdentity => {
  const { name, prefix, hosts, ports, projectRoot, k3d } = params;
  const composeName = `${prefix}-${name}`;
  const k3dClusterName = k3d?.enabled ? shortenK3dClusterName(composeName) : undefined;
  const kubeconfigPath = k3dClusterName
    ? k3d?.kubeconfigPath !== undefined
      ? path.resolve(projectRoot, k3d.kubeconfigPath)
      : path.join(os.homedir(), ".kube", k3dClusterName)
    : undefined;

  let k3dRegistryName: string | undefined;
  if (k3d?.registry?.enabled && k3dClusterName) {
    const registryPort = ports.K3D_REGISTRY_PORT;
    if (!registryPort) {
      throw new SiloError(
        "K3D_REGISTRY_PORT must be defined in ports when registry is enabled",
        "INVALID_CONFIG"
      );
    }
    k3dRegistryName = `${k3dClusterName}-registry.localhost:${registryPort}`;
  }

  const identity: InstanceIdentity = {
    name,
    prefix,
    composeName,
    dockerNetwork: composeName,
    volumePrefix: composeName,
    containerPrefix: `${composeName}-`,
    hosts,
  };

  if (k3dClusterName) {
    identity.k3dClusterName = k3dClusterName;
    if (kubeconfigPath) {
      identity.kubeconfigPath = kubeconfigPath;
    }
  }

  if (k3dRegistryName) {
    identity.k3dRegistryName = k3dRegistryName;
  }

  return identity;
};
