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
  "--port=${HTTP_PORT}:80@loadbalancer",
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

Define `HTTP_PORT` in `[ports]` for that mapping. If the registry is enabled,
define `K3D_REGISTRY_PORT`. Silo also claims `K3D_API_PORT` automatically if
omitted. All host publications must use declared allocated ports.

## Naming and Paths

silo derives names from `{prefix}-{name}`:

- Cluster name: `{prefix}-{name}`
- Registry name: `{prefix}-{name}-registry.localhost:{K3D_REGISTRY_PORT}`
- Kubeconfig path: `~/.kube/{prefix}-{name}`

## Lifecycle Behavior

- `silo up` creates its cluster, or reuses only its own exact recorded objects.
  Existing unreceipted clusters, registries, networks or volumes refuse with
  `NAME_CONFLICT`; they are never adopted or deleted.
- `silo down` keeps the cluster by default.
- `silo down --delete-cluster` deletes only exact receipt-bound objects.
- Retention, failed teardown and uncertain creation keep names/ports reserved.
  `--clean` refuses while resources remain. No name-wide k3d delete is used.

## Kubeconfig

`k3d.kubeconfigPath` optionally selects a literal project-relative kubeconfig
file, for example `.localnet/kubeconfig`. silo resolves it from the directory
containing `silo.toml` into instance identity and exports that absolute path
as `KUBECONFIG`. Omission keeps `~/.kube/<cluster-name>`. See `silo doc config`
for validation and profile rules. The global kubeconfig is not updated.

## k3d.args Interpolation

Arguments in `k3d.args` are interpolated after ports and URLs resolve, so they
can reference identity, hosts, ports, and URLs.

Silo owns network, API port, registry creation, runtime labels, rollback and
kubeconfig control flags; overriding them refuses. Backend endpoint/engine ID
is checked before effects. Remote engines and failed absence queries refuse.

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
