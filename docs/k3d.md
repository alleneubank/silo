# k3d Integration

This document describes the optional k3d integration. It is bundled with the
CLI and can be printed with:

```
silo doc k3d
```

## Enable k3d

```toml
[k3d]
enabled = true
args = [
  # Route host:8080 → cluster ingress port 80 via the k3d loadbalancer
  "--port=8080:80@loadbalancer",
]

[k3d.registry]
enabled = true
advertise = true
# Optional overrides for ConfigMap fields:
# host = "localhost:${K3D_REGISTRY_PORT}"
# hostFromContainerRuntime = "localnet-dev-registry.localhost:5000"
# hostFromClusterNetwork = "localnet-dev-registry.localhost:5000"
# help = "See registry docs"
```

If the registry is enabled, define `K3D_REGISTRY_PORT` in `[ports]`.

## Naming and Paths

silo derives names from `{prefix}-{name}`:

- Cluster name: `{prefix}-{name}`
- Registry name: `{prefix}-{name}-registry.localhost:{K3D_REGISTRY_PORT}`
- Kubeconfig path: `~/.kube/{prefix}-{name}`

## Lifecycle Behavior

- `silo up` creates the cluster if missing, otherwise reuses it.
- `silo down` keeps the cluster by default.
- `silo down --delete-cluster` deletes it.

## Kubeconfig

`k3d.kubeconfigPath` optionally selects a literal project-relative kubeconfig
file, for example `.localnet/kubeconfig`. silo resolves it from the directory
containing `silo.toml` into instance identity and exports that absolute path
as `KUBECONFIG`. Omission keeps `~/.kube/<cluster-name>`. See `silo doc config`
for validation and profile rules. The global kubeconfig is not updated.

## k3d.args Interpolation

Arguments in `k3d.args` are interpolated after ports and URLs resolve, so they
can reference identity, hosts, ports, and URLs.

## Registry Advertising

When `k3d.registry.enabled = true`, silo advertises the registry using the
standard `local-registry-hosting` ConfigMap in the `kube-public` namespace. This
allows Tilt to auto-discover the registry without `default_registry()`.

Overrides:
- `k3d.registry.advertise` (default: true)
- `k3d.registry.host`
- `k3d.registry.hostFromContainerRuntime`
- `k3d.registry.hostFromClusterNetwork`
- `k3d.registry.help`

Registry override fields support interpolation (same variables as URLs).

## External Registry Advertising

You can advertise an external registry without k3d by setting a top-level
`[registry]` block:

```toml
[registry]
advertise = true
host = "127.0.0.1:5001"
hostFromContainerRuntime = "registry.localhost:5000"
hostFromClusterNetwork = "registry.localhost:5000"
help = "See registry docs"
```

## Tool Requirements

- `k3d` is required when k3d is enabled.
- `kubectl` is required when registry advertisement is enabled.
