# silo.toml Reference

This document is the canonical reference for configuring silo. It is bundled
with the CLI and can be printed with:

```
silo doc config
```

## Minimal Example

```toml
version = 1

[ports]
WEB_PORT = 3000
API_PORT = 8080
```

## Full Example

```toml
version = 1

# Optional fields with defaults:
prefix = "localnet"           # Resource naming prefix (default: "localnet")
output = ".localnet.env"      # Output file location (default: ".localnet.env")

[ports]
POSTGRES_PORT = 5432
REDIS_PORT = 6379
API_PORT = 8080
WEB_PORT = 3000
ADMIN_PORT = 3001
METRICS_PORT = "random"
TILT_PORT = 10350
K3D_REGISTRY_PORT = 5000  # Only used if k3d.registry.enabled

[hosts]
APP_HOST = "${name}.localhost"
ADMIN_HOST = "admin.${name}.localhost"
API_HOST = "api.${name}.localhost"
TILT_HOST = "127.0.0.1"  # Optional; defaults to APP_HOST

[urls]
DATABASE_URL = "postgres://user:pass@localhost:${POSTGRES_PORT}/dev"
REDIS_URL = "redis://localhost:${REDIS_PORT}"
API_URL = "http://${API_HOST}:${API_PORT}"
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"
ADMIN_URL = "http://${ADMIN_HOST}:${ADMIN_PORT}"

[k3d]
enabled = true
kubeconfigPath = ".localnet/kubeconfig" # Optional; default: ~/.kube/<cluster-name>
args = [
  # "--agents=2",  # Optional: adds worker nodes for multi-node testing
  # Route host ports to cluster ingress via the k3d loadbalancer
  "--port=${API_PORT}:80@loadbalancer",
  "--port=${ADMIN_PORT}:443@loadbalancer",
]

[k3d.registry]
enabled = true
advertise = true

[tilt]
webMode = "prod" # Optional; use Tilt's embedded production assets

# Optional external registry advertisement
# [registry]
# advertise = true
# host = "127.0.0.1:5001"

[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-db.sh", "./scripts/generate-certs.sh"]
```

## Top-Level Fields

- `version` (required): Must be `1`.
- `prefix` (optional): Resource naming prefix. Default: `localnet`.
- `output` (optional): Literal ASCII project-relative env file path. Default:
  `.localnet.env`. No traversal, expansion, symlinks, hardlinks or physical
  aliases with another file role. Existing unreceipted outputs refuse.
- `ports` (required for `env`, `up` and `ci`): Map of port names to default
  values (at least one entry). Use `random` or `0` to always allocate from the
  fallback space outside the kernel's ephemeral range. A project that only uses
  `silo run` may omit it.
- `hosts` (optional): Hostname templates. Default: `APP_HOST = "${name}.localhost"`.
- `urls` (optional): URL templates. Default: empty.
- `k3d` (optional): k3d cluster integration settings.
- `tilt` (optional): Tilt launch settings.
- `hooks` (optional): Lifecycle hook commands.
- `registry` (optional): registry advertisement settings for non-k3d clusters.
- `slots` (optional): host slots this project's `silo run` commands hold.

## Ports

Ports are allocated in declaration order. For each port key:

1. An existing generation retains its committed ports; a lockfile is only a
   snapshot. Reconfiguration requires stopped/reconciled state and `--force`.
2. For a new generation, if the configured value is `random`/`0`, a free
   fallback port is allocated.
3. Otherwise, the configured default is tried. If it is occupied, claimed or
   inside the kernel's ephemeral range, the next free fallback port is allocated.

The fallback space is 1024-65535 minus the kernel's live ephemeral range,
read at allocation (`net.inet.ip.portrange.first`/`last` on macOS,
`net.ipv4.ip_local_port_range` on Linux), scanned from the highest port down.
A port inside the ephemeral range passes a bind probe and can still be taken by
the kernel later, for example by an SSH forward. Existing generations keep
their published ports; the rule applies to new allocations. A host whose
ephemeral range covers all of 1024-65535 leaves no fallback port, and
allocation refuses with `PORTS_EXHAUSTED`; an unreadable range refuses with
`EPHEMERAL_RANGE_UNAVAILABLE`.

Rules:
- Ports must be within 1-65535.
- Duplicate defaults are allowed; the first gets the default, the second gets a fallback port.
- `random`/`0` skips the default check and always uses a fallback port.

## Hosts

Hosts are used for browser isolation. Templates can only reference identity variables.

```toml
[hosts]
APP_HOST = "${name}.localhost"
API_HOST = "api.${name}.localhost"
```

Defaults:
- If `hosts` is omitted, `APP_HOST = "${name}.localhost"` is added.
- `TILT_HOST` defaults to `APP_HOST` when omitted; explicit values are preserved.

## URLs

URL templates can reference identity, hosts, and ports:

```toml
[urls]
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"
API_URL = "http://${name}.localhost:${API_PORT}"
```

## k3d

Enable k3d integration to create/delete a cluster as part of `silo up/down`.

```toml
[k3d]
enabled = true
args = [
  "--port=${API_PORT}:80@loadbalancer",
]

[k3d.registry]
enabled = true
advertise = true
host = "localhost:${K3D_REGISTRY_PORT}"
hostFromContainerRuntime = "localnet-dev-registry.localhost:5000"
hostFromClusterNetwork = "localnet-dev-registry.localhost:5000"
help = "See registry docs"
```

The loadbalancer routes traffic from your host into the cluster. Without it, you'd
need `kubectl port-forward` for every service.

Notes:
- Registry port requires `ports.K3D_REGISTRY_PORT`. The k3d API port is also
  claimed (`K3D_API_PORT`, automatically added if omitted).
- User mappings must use declared allocated host ports. Silo owns network,
  registry creation, API port, labels and kubeconfig control flags.
- `k3d.args` can use interpolation variables (see below).
- `k3d.kubeconfigPath` is an optional literal project-relative file path, such
  as `.localnet/kubeconfig`. It resolves from the directory containing
  `silo.toml`, once into instance identity. All generated env, hooks, Tilt,
  registry advertisement and status consumers use that resolved path.
  Omission keeps `~/.kube/<cluster-name>`. Disabled k3d exports no kubeconfig.
  Paths use letters, numbers, `_`, `-`, `.`, and `/`, with no empty, `.` or
  `..` components. Absolute paths, home expansion, interpolation, backslashes
  and path-list separators are rejected. Parent/final symlinks and hardlinks
  refuse. File receipts protect the physical target across configuration edits.

## Tilt

```toml
[tilt]
webMode = "prod"
```

`tilt.webMode` optionally selects embedded production web assets with exactly
`--web-mode=prod` for `silo up` and `silo ci`. The only accepted selection is
`prod`; `local` and other values refuse at config load. Omission preserves
Tilt's default behavior. silo does not set `TILT_WEB_MODE`. A CI passthrough
`--web-mode` conflicts with an explicit selection and refuses before setup.
Profiles can override `tilt.webMode` and `k3d.kubeconfigPath`.

## Registry (External)

Advertise an external registry to your cluster without k3d:

```toml
[registry]
advertise = true
host = "127.0.0.1:5001"
hostFromContainerRuntime = "registry.localhost:5000"
hostFromClusterNetwork = "registry.localhost:5000"
help = "See registry docs"
```

Registry fields support interpolation (same variables as URLs).

## Hooks

Hooks run shell commands at lifecycle points:

```toml
[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-db.sh"]
```

Hooks inherit all generated env vars (ports, hosts, URLs, etc).

## Slots

Slots are host resources `silo run` holds for one command (see `silo doc
commands`). A project declares what each slot needs and its default cap; a
host operator may override caps in `<account home>/.silo/host.toml`:

```toml
[slots.ios-simulator]
cap = { macos = 2 }   # no default on Linux
env = { OPF_SIM_DEVICE = "opf-slot-${slot}" }
on-acquire = ["./scripts/acquire-simulator.sh"]

[slots.phone-ports]
cap = 4
ports = 6
env = { OPF_E2E_PHONE_PORT_BASE = "${ports.0}" }
```

- `cap` (optional): how many runs may hold the slot at once on a host, 1-64.
  One number for every OS, or a table naming `macos` and/or `linux`; an OS the
  table omits has no default. A host file entry overrides it; with none, the
  smallest default among the projects queued for the slot applies. A slot with
  no cap from either source refuses with `SLOT_UNAVAILABLE`.
- `env` (optional): variables injected into `on-acquire` and the command.
  `${slot}` is the unit index (`0 .. cap-1`, stable per unit); `${ports.i}` is
  the i-th port of the slot's block. Other placeholders refuse. Two requested
  slots may not inject the same variable.
- `on-acquire` (optional): shell commands run in order, in the project root,
  after the unit is granted and before the command. Each must reset the unit to
  a known state whatever the previous holder left. Up to 32 steps.
- `ports` (optional): size of a contiguous host-port block held for the run
  (1-256), outside the kernel's ephemeral range. Default: none.

Slot names use lowercase letters, digits and `-`. `silo run --slot <name>`
refuses with `SLOT_UNAVAILABLE` when the name is not declared here or not
capped in the host file.

## Interpolation

Templates use `${VAR}` syntax. Resolution happens in phases:

1. Identity variables (`name`, `prefix`, `WORKSPACE_NAME`, `COMPOSE_PROJECT_NAME`)
2. Hosts (can reference identity only)
3. Ports (allocated, no interpolation)
4. URLs (can reference identity, hosts, ports)
5. `k3d.args` (can reference identity, hosts, ports)

### Available Variables Summary

| In `hosts`  | In `urls`                 | In `k3d.args`             |
| ----------- | ------------------------- | ------------------------- |
| `${name}`   | `${name}`                 | `${name}`                 |
| `${prefix}` | `${prefix}`               | `${prefix}`               |
|             | `${WORKSPACE_NAME}`       | `${WORKSPACE_NAME}`       |
|             | `${COMPOSE_PROJECT_NAME}` | `${COMPOSE_PROJECT_NAME}` |
|             | All `hosts.*` keys        | All `hosts.*` keys        |
|             | All `ports.*` keys        | All `ports.*` keys        |

## Generated Env Vars

silo writes an env file that includes:
- Identity: `WORKSPACE_NAME`, `COMPOSE_PROJECT_NAME`, `DOCKER_NETWORK`, `VOLUME_PREFIX`, `CONTAINER_PREFIX`
- Hosts: `APP_HOST`, `API_HOST`, `TILT_HOST`, etc
- Ports: all entries from `[ports]`
- k3d: `K3D_CLUSTER_NAME`, `K3D_REGISTRY_NAME`, `KUBECONFIG` (if enabled)
- URLs: all entries from `[urls]`
