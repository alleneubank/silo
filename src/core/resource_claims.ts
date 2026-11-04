import type { Claim } from "./lease_types";
import type { InstanceState, ResolvedConfig } from "./types";

/** Final rendered identities share engine-independent namespaces within the account. */
export const resourceClaims = (state: InstanceState, config: ResolvedConfig): Claim[] => {
  const identity = state.identity;
  const claims: Claim[] = [
    { domain: "instance-name", resource: state.name },
    ...Object.values(state.ports).map(port => ({ domain: "host-port", resource: String(port) })),
    { domain: "compose-name", resource: identity.composeName },
    { domain: "network", resource: identity.dockerNetwork },
  ];
  for (const kind of ["container", "network", "volume"]) {
    for (const separator of ["-", "_"]) claims.push({ domain: kind, resource: identity.composeName + separator, prefix: true });
  }
  for (const [key, template] of Object.entries(config.hosts)) {
    const host = identity.hosts[key];
    if (host && template.includes("${")) claims.push({ domain: "hostname", resource: host.toLowerCase() });
  }
  if (identity.k3dClusterName) {
    const cluster = identity.k3dClusterName;
    claims.push(
      { domain: "k3d-cluster", resource: cluster },
      { domain: "container", resource: `k3d-${cluster}-`, prefix: true },
      { domain: "network", resource: `k3d-${cluster}` },
      { domain: "volume", resource: `k3d-${cluster}-images` },
    );
  }
  if (identity.k3dRegistryName) {
    const host = identity.k3dRegistryName.split(":")[0]!;
    claims.push({ domain: "k3d-registry", resource: host }, { domain: "container", resource: host });
  }
  return claims.filter((claim, index) => !claims.some((other, otherIndex) =>
    other.domain === claim.domain && otherIndex !== index && (
      (other.resource === claim.resource && otherIndex < index) ||
      (other.prefix && other.resource !== claim.resource && claim.resource.startsWith(other.resource))
    ),
  ));
};
