# silo Specification

Isolated local development environments. Solves instance isolation and k3d bootstrap sequencing for Tilt-based projects.

## Problem Statement

Running multiple instances of the same project on localhost causes conflicts:

- **Port collisions**: Hardcoded ports (3000, 5432, 8080) fight for binding
- **Data corruption**: Shared Docker volumes cause cross-instance data bleed
- **Auth confusion**: Browser cookies/localStorage shared across `localhost:*` ports
- **Ambiguous resources**: Can't identify which containers/volumes belong to which instance
- **Bootstrap chicken-egg**: Tilt needs k3d cluster, but who creates it?

## Quick Start

**Minimal config** (`silo.toml`):

```toml
version = 1

[ports]
WEB_PORT = 3000
API_PORT = 8080
```

**Usage**:

```bash
silo init        # Create silo.toml starter config
silo up          # Generates name, allocates ports, starts Tilt
silo status      # Show current instance
silo down        # Stop Tilt
```

**Generated env** (`.localnet.env`):

```bash
WORKSPACE_NAME=myproject-a3f7
COMPOSE_PROJECT_NAME=localnet-myproject-a3f7
APP_HOST=myproject-a3f7.localhost
WEB_PORT=3000
API_PORT=8080
```

For k3d cluster support, add:

```toml
[k3d]
enabled = true

[k3d.registry]
enabled = true
```

## Solution Overview

silo coordinates the local dev environment lifecycle:

```
silo up <name>
         |
         v
+---------------------------+
| Validate tools exist      |
| (tilt, k3d if configured) |
+---------------------------+
         |
         v
+---------------------------+
| Generate instance identity|
| - COMPOSE_PROJECT_NAME    |
| - K3D_CLUSTER_NAME        |
| - APP_HOST (*.localhost)  |
+---------------------------+
         |
         v
+---------------------------+
| Allocate ports            |
| - Try defaults first      |
| - Fall back to ephemeral  |
+---------------------------+
         |
         v
+---------------------------+
| Write env file + lockfile |
+---------------------------+
         |
         v
+---------------------------+
| Create k3d cluster        |
| (if configured)           |
+---------------------------+
         |
         v
+---------------------------+
| Start Tilt (foreground)   |
| Ctrl+C stops everything   |
+---------------------------+
```

## CLI Interface

```
silo <command> [options]

Commands:
  help [command]  Show help (global or per-command)
  init            Create silo.toml starter config
  doc [topic]     Show bundled docs (e.g., config)
  up [name]       Start environment (creates k3d if needed, starts Tilt)
  down            Stop environment (stops Tilt, keeps k3d by default)
  status          Show current instance state
  env [name]      Generate env file only, don't start anything
  profiles        List available profiles from silo.toml

Arguments:
  [name]          Instance name (e.g., main, feature-x, dev)
                  If omitted: reuses name from lockfile
                  If no lockfile: generates from directory + random suffix

Global Options:
  -c, --config    Path to config file (default: silo.toml)
  -v, --verbose   Show verbose output (config path, detailed steps)
  -h, --help      Show help

Help:
  silo help <command>
  silo <command> --help

Command Options:
  up:
    -f, --force       Regenerate ports; start a parallel stack if one is live
    -p, --profile     Use named profile (overrides SILO_PROFILE env var)

  env:
    -p, --profile     Use named profile for env generation

  down:
    --delete-cluster   Delete k3d cluster (default: keep for faster iteration)
    --clean            Remove env file and lockfile

Examples:
  silo help up                    # Show subcommand help
  silo init                       # Create silo.toml in current directory
  silo doc config                 # Print silo.toml reference
  silo up dev                     # Start instance 'dev'
  silo up                         # Reuse last instance (and profile) from lockfile
  silo up --profile testnet       # Start with testnet profile
  silo up --profile testnet -f    # Switch to testnet profile (requires --force)
  silo env feature-x              # Generate env only
  silo env --profile devnet       # Generate env with devnet profile
  silo down                       # Stop Tilt (keep k3d)
  silo down --delete-cluster      # Stop Tilt and delete k3d
  silo status                     # Show what's running (includes active profile)
  silo profiles                   # List available profiles

Environment Variables:
  SILO_PROFILE    Default profile when --profile not specified (flag takes precedence)
```

## Configuration Schema

Projects define their environment in `silo.toml`:

For the canonical config reference, run:
```
silo doc config
```

```toml
version = 1

# Optional fields with defaults:
prefix = "localnet"           # Resource naming prefix (default: 'localnet')
output = ".localnet.env"      # Output file location (default: '.localnet.env')

# Port definitions with defaults
# silo tries default first, allocates from ephemeral range if occupied
[ports]
POSTGRES_PORT = 5432
REDIS_PORT = 6379
API_PORT = 8080
WEB_PORT = 3000
ADMIN_PORT = 3001
TILT_PORT = 10350
K3D_REGISTRY_PORT = 5000  # Only used if k3d.registry.enabled

# Host definitions for browser isolation
# ${name} is replaced with instance name (e.g., "feature-x")
# Default if omitted: APP_HOST = "${name}.localhost"
[hosts]
APP_HOST = "${name}.localhost"
ADMIN_HOST = "admin.${name}.localhost"
API_HOST = "api.${name}.localhost"

# URL templates (optional) - shell-style ${VAR} interpolation
# Available vars: all ports, all hosts, WORKSPACE_NAME, etc.
[urls]
DATABASE_URL = "postgres://user:pass@localhost:${POSTGRES_PORT}/dev"
REDIS_URL = "redis://localhost:${REDIS_PORT}"
API_URL = "http://${API_HOST}:${API_PORT}"
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"
ADMIN_URL = "http://${ADMIN_HOST}:${ADMIN_PORT}"

# k3d cluster configuration (optional)
# If present, silo creates/deletes k3d cluster as part of lifecycle
[k3d]
enabled = true
# Full k3d passthrough - any k3d cluster create flags
args = [
  "--agents=2",
  "--port=8080:80@loadbalancer",
  "--port=8443:443@loadbalancer",
]

# Registry configuration (port allocated via ports.K3D_REGISTRY_PORT)
[k3d.registry]
enabled = true

# Lifecycle hooks (optional)
# Run shell commands at lifecycle points
[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-db.sh", "./scripts/generate-certs.sh"]
pre-down = ["./scripts/backup-state.sh"]
post-down = []

# Profiles for environment-specific overrides (optional)
# Each profile can override any config section
# Usage: silo up --profile testnet-local

[profiles.testnet-local]
# Override URLs for testnet environment
urls.KEYCLOAK_URL = "https://auth.testnet.example.com"
urls.LEDGER_API_URL = "https://grpc.testnet.example.com"
# Add profile-only variables (not in base config)
urls.KEYCLOAK_REALM = "testnet"
# Override k3d settings
k3d.enabled = false  # Don't need local cluster for remote testnet

[profiles.testnet-local.append]
# Append to base arrays (instead of replacing)
hooks.post-up = ["./scripts/testnet-setup.sh"]

[profiles.devnet-local]
urls.KEYCLOAK_URL = "https://auth.devnet.example.com"
urls.LEDGER_API_URL = "https://grpc.devnet.example.com"
urls.KEYCLOAK_REALM = "devnet"
```

## Core Types

```typescript
interface SiloConfig {
  version: 1;
  prefix?: string; // Default: 'localnet'
  output?: string; // Default: '.localnet.env'
  ports: Record<string, number | "random">; // Required: at least one port (0 allowed as alias for "random")
  hosts?: Record<string, string>; // Default: { APP_HOST: '${name}.localhost' }
  urls?: Record<string, string>; // Optional: omit if no derived URLs needed
  k3d?: K3dConfig;
  hooks?: LifecycleHooks;
  profiles?: Record<string, ProfileConfig>; // Optional: environment-specific overrides
  registry?: RegistryConfig; // Optional: external registry advertisement
}

// Defaults applied at config load time
const CONFIG_DEFAULTS = {
  prefix: "localnet",
  output: ".localnet.env",
  hosts: { APP_HOST: "${name}.localhost" },
  urls: {},
} as const;

interface K3dConfig {
  enabled: boolean;
  args?: string[];
  registry?: {
    enabled: boolean;
    advertise?: boolean; // Default: true
    host?: string;
    hostFromContainerRuntime?: string;
    hostFromClusterNetwork?: string;
    help?: string;
    // Port allocated via ports.K3D_REGISTRY_PORT (default: 5000)
  };
}

interface LifecycleHooks {
  "pre-up"?: string[];
  "post-up"?: string[];
  "pre-down"?: string[];
  "post-down"?: string[];
}

// Profile overrides - can override any config section
// Values are merged with base config (profile wins on conflict)
interface ProfileConfig {
  ports?: Record<string, number | "random">; // Override port defaults (0 allowed as alias for "random")
  hosts?: Record<string, string>; // Override host templates
  urls?: Record<string, string>; // Override/add URL templates
  k3d?: Partial<K3dConfig>; // Override k3d settings
  hooks?: Partial<LifecycleHooks>; // Replace hook arrays
  append?: ProfileAppendConfig; // Append to arrays instead of replacing
  registry?: RegistryConfig; // Override external registry advertisement
}

// Append section for array fields
interface ProfileAppendConfig {
  hooks?: Partial<LifecycleHooks>; // Appended after base hooks
  k3d?: { args?: string[] }; // Appended after base k3d.args
}

interface RegistryConfig {
  advertise?: boolean; // Default: true
  host?: string;
  hostFromContainerRuntime?: string;
  hostFromClusterNetwork?: string;
  help?: string;
}

interface InstanceIdentity {
  name: string; // Sanitized workspace name
  prefix: string; // Resource prefix (e.g., localnet)
  composeName: string; // Docker Compose project name
  dockerNetwork: string; // Docker network name
  volumePrefix: string; // Docker volume prefix
  containerPrefix: string; // Container name prefix
  hosts: Record<string, string>; // Resolved hosts including built-in TILT_HOST
  k3dClusterName?: string; // K3d cluster name if k3d enabled (<=32 chars, may be shortened)
  k3dRegistryName?: string; // K3d registry name if k3d enabled
  kubeconfigPath?: string; // Path to kubeconfig for this instance
}

interface InstanceState {
  name: string;
  profile?: string; // Active profile name (undefined = base config)
  ports: Record<string, number>;
  identity: InstanceIdentity;
  createdAt: string;
  k3dClusterCreated: boolean;
  tiltPid?: number; // Set when Tilt starts, cleared on clean exit
  tiltStartedAt?: string; // ISO timestamp when Tilt was started
  disownedTilts?: DisownedTilt[]; // Stacks left running by `silo up --force`
}

interface DisownedTilt {
  pid: number; // Supervisor pid of the stack that no longer owns the lockfile
  name: string; // Instance name it was started as
  ports: Record<string, number>; // Ports it still answers on
  startedAt?: string; // ISO timestamp when it was started
  disownedAt: string; // ISO timestamp when `--force` disowned it
}

interface Lockfile {
  version: 1;
  generatedAt: string;
  instance: InstanceState;
}
```

## Output Files

### Environment File (configurable path, default: .localnet.env)

```bash
# Generated by silo
# Instance: feature-x
# Profile: testnet-local
# Generated: 2024-01-15T10:30:00Z

# === Instance Identity ===
WORKSPACE_NAME=feature-x
SILO_PROFILE=testnet-local
COMPOSE_PROJECT_NAME=localnet-feature-x
DOCKER_NETWORK=localnet-feature-x
VOLUME_PREFIX=localnet-feature-x
CONTAINER_PREFIX=localnet-feature-x-

# === Hosts (browser isolation) ===
APP_HOST=feature-x.localhost
ADMIN_HOST=admin.feature-x.localhost
API_HOST=api.feature-x.localhost
TILT_HOST=feature-x.localhost

# === Allocated Ports ===
POSTGRES_PORT=5432
REDIS_PORT=6379
API_PORT=8080
WEB_PORT=3000
ADMIN_PORT=3001
TILT_PORT=10350
K3D_REGISTRY_PORT=5000

# === k3d (if enabled) ===
K3D_CLUSTER_NAME=localnet-feature-x
K3D_REGISTRY_NAME=localnet-feature-x-registry.localhost:5000
KUBECONFIG=/home/user/.kube/localnet-feature-x

# === Derived URLs ===
DATABASE_URL=postgres://user:pass@localhost:5432/dev
REDIS_URL=redis://localhost:6379
API_URL=http://api.feature-x.localhost:8080
WEB_URL=http://feature-x.localhost:3000
ADMIN_URL=http://admin.feature-x.localhost:3001
```

### Child Process Environment

When silo launches child processes (Tilt, hooks, k3d, kubectl), it injects:

- `SILO_ACTIVE=1`
- `SILO_WORKSPACE=<workspace name>`
- `SILO_ENV_FILE=<absolute path to generated env file>`

### Tilt Extension (require)

silo ships a small Tilt extension to enforce silo-only execution.

Local (bundled with this repo):

```python
load('./tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
```

From npm (recommended for CI):

```python
load('./node_modules/@0xbigboss/silo/tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
```

CI runners often cannot authenticate HTTPS clones for `extension_repo()`, so
prefer the npm-local path in non-interactive environments.

From a GitHub-hosted extension repo:

```python
v1alpha1.extension_repo(name='default', url='https://github.com/<org>/<tilt-extensions-repo>')
load('ext://silo/require', 'SILO_REQUIRE')
```

If the extension is published to the default Tilt extensions repo, you can
skip `extension_repo` and just use the `load('ext://...')` line.

### Startup Claim (.silo.startup)

Written by `silo up` for the duration of a startup and removed when it ends,
including on failure. It holds `{ "pid", "nonce", "claimedAt" }` for the silo
process that is starting a stack. A second `silo up` for the same project root
refuses with `STARTUP_IN_PROGRESS` while the claim's pid is alive -- however
long that takes, since hooks and k3d creation legitimately run for minutes. A
claim left behind by a killed process is reclaimed; because reclaiming is a
remove followed by a create, the reclaimer confirms its own `nonce` is in the
file before proceeding, and releases the claim only while that nonce is still
there. The 24-hour age bound exists solely to resolve a claim whose pid was
recycled by an unrelated process.

### Lockfile (.silo.lock)

```json
{
  "version": 1,
  "generatedAt": "2024-01-15T10:30:00Z",
  "instance": {
    "name": "feature-x",
    "profile": "testnet-local",
    "ports": {
      "POSTGRES_PORT": 5432,
      "REDIS_PORT": 6379,
      "API_PORT": 8080,
      "WEB_PORT": 3000,
      "ADMIN_PORT": 3001,
      "TILT_PORT": 10350,
      "K3D_REGISTRY_PORT": 5000
    },
    "identity": {
      "name": "feature-x",
      "prefix": "localnet",
      "composeName": "localnet-feature-x",
      "dockerNetwork": "localnet-feature-x",
      "volumePrefix": "localnet-feature-x",
      "containerPrefix": "localnet-feature-x-",
      "hosts": {
        "APP_HOST": "feature-x.localhost",
        "ADMIN_HOST": "admin.feature-x.localhost",
        "API_HOST": "api.feature-x.localhost",
        "TILT_HOST": "feature-x.localhost"
      },
      "k3dClusterName": "localnet-feature-x",
      "k3dRegistryName": "localnet-feature-x-registry.localhost",
      "kubeconfigPath": "/home/user/.kube/localnet-feature-x"
    },
    "createdAt": "2024-01-15T10:30:00Z",
    "k3dClusterCreated": true
  }
}
```

## Variable Interpolation

Variables use shell-style `${VAR}` syntax. Resolution happens in phases:

### Phase 1: Identity Variables (computed first)

These are derived from the instance name and config:

| Variable                  | Source                     | Example              |
| ------------------------- | -------------------------- | -------------------- |
| `${name}`                 | Sanitized instance name    | `feature-x`          |
| `${prefix}`               | Config `prefix` or default | `localnet`           |
| `${WORKSPACE_NAME}`       | Same as `${name}`          | `feature-x`          |
| `${COMPOSE_PROJECT_NAME}` | `{prefix}-{name}`          | `localnet-feature-x` |

### Phase 2: Hosts (can use identity variables)

Host templates can only reference identity variables:

```toml
[hosts]
APP_HOST = "${name}.localhost"           # OK: uses ${name}
ADMIN_HOST = "admin.${name}.localhost"   # OK: uses ${name}
# APP_HOST = "${WEB_PORT}.localhost"     # ERROR: ports not yet resolved
```

### Phase 3: Ports (allocated, no interpolation)

Ports are allocated from defaults or ephemeral range. No interpolation in port values.

### Phase 4: URLs (can use all variables)

URL templates can reference identity, hosts, and ports:

```toml
[urls]
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"           # OK: host + port
API_URL = "http://${name}.localhost:${API_PORT}"     # OK: identity + port
DATABASE_URL = "postgres://user:pass@localhost:${POSTGRES_PORT}/dev"  # OK
```

### Phase 5: k3d.args (can use all variables)

k3d arguments can reference identity, hosts, and ports:

```toml
[k3d]
enabled = true
args = [
  "--agents=1",
  "--port=${K3D_LB_HTTP_PORT}:80@loadbalancer",  # OK: uses allocated port
  "--port=${K3D_LB_HTTPS_PORT}:443@loadbalancer",
]
```

This allows k3d port mappings to use dynamically allocated ports.

### Available Variables Summary

| In `hosts`  | In `urls`                 | In `k3d.args`             |
| ----------- | ------------------------- | ------------------------- |
| `${name}`   | `${name}`                 | `${name}`                 |
| `${prefix}` | `${prefix}`               | `${prefix}`               |
|             | `${WORKSPACE_NAME}`       | `${WORKSPACE_NAME}`       |
|             | `${COMPOSE_PROJECT_NAME}` | `${COMPOSE_PROJECT_NAME}` |
|             | All `hosts.*` keys        | All `hosts.*` keys        |
|             | All `ports.*` keys        | All `ports.*` keys        |

## Profile Override Rules

Profiles allow environment-specific configuration without modifying base config.

### Profile Resolution Order

1. **--profile flag**: Highest priority, explicitly specified
2. **SILO_PROFILE env var**: Used if no --profile flag
3. **Lockfile profile**: Used if no flag and no env var (on subsequent runs)
4. **No profile**: Use base config directly

### Merge Semantics

Profiles merge with base config using these rules:

| Field Type | Behavior |
| ---------- | -------- |
| Scalar values | Profile value replaces base value |
| Object fields (ports, hosts, urls) | Shallow merge, profile keys override base keys |
| Array fields (hooks, k3d.args) | Profile array replaces base array |
| `[profiles.x.append]` arrays | Appended after base array |

**Example merge:**

```toml
# Base config
[urls]
API_URL = "http://localhost:8080"
WEB_URL = "http://localhost:3000"

[hooks]
post-up = ["./scripts/seed-db.sh"]

# Profile
[profiles.testnet]
urls.API_URL = "https://api.testnet.example.com"  # Overrides base
urls.EXTRA_URL = "https://extra.example.com"       # Added (profile-only var)

[profiles.testnet.append]
hooks.post-up = ["./scripts/testnet-setup.sh"]    # Appended to base
```

**Merged result (when using testnet profile):**

```bash
API_URL=https://api.testnet.example.com   # From profile
WEB_URL=http://localhost:3000             # From base (not overridden)
EXTRA_URL=https://extra.example.com       # From profile (new var)
# hooks.post-up executes: seed-db.sh, then testnet-setup.sh
```

### Profile Switching

Switching profiles on an existing instance requires `--force`:

```bash
# Initial run with testnet profile
silo up --profile testnet

# Attempting to switch profiles without --force: ERROR
silo up --profile devnet
# Error: Profile change requires --force (current: testnet, requested: devnet)

# Force switch to different profile
silo up --profile devnet --force
```

**Rationale**: Prevents accidental profile switches that could change URLs, k3d settings, or hooks mid-session.

### Validation

- **Unknown profile**: Error if `--profile <name>` references undefined profile
- **No profiles defined**: Error if `--profile` used but `[profiles]` section missing
- **New variables allowed**: Profiles can introduce variables not defined in base config

### Profile-Aware Port Allocation

When a profile overrides ports, those ports go through normal allocation:

1. If profile's value is `random`, allocate from ephemeral range
2. Otherwise, try profile's port value as default
3. Fall back to ephemeral range if occupied
4. Lockfile stores final allocated ports (not profile defaults)

This ensures isolation even when profiles specify the same port defaults.

## Port Allocation Strategy

**Default-first**: Try the configured default port. Only allocate from ephemeral range (49152-65535) if the default is occupied. Use `random`/`0` to skip defaults and always allocate from the ephemeral range.

### Allocation Algorithm

```
for each port_key in config.ports (in declaration order):
  if lockfile exists AND lockfile.ports[port_key] is free:
    use lockfile.ports[port_key]
  else if config.ports[port_key] == "random":
    allocate next free port from ephemeral range (49152-65535)
  else if config.ports[port_key] (default) is free:
    use config.ports[port_key]
  else:
    allocate next free port from ephemeral range (49152-65535)

  mark allocated port as used (can't be reused for another key)
```

### Port Validation Rules

- **Duplicate defaults**: If two ports have the same default (e.g., both 8080), second one gets ephemeral
- **Invalid range**: Ports must be 1-65535 (or `random`/`0`); values outside this range are errors
- **Availability check**: TCP bind test on both `0.0.0.0` and `127.0.0.1` with 100ms timeout (for CI compatibility). A port is free only if binding succeeds on both addresses — checking only `0.0.0.0` misses ports bound exclusively to loopback (e.g. Tilt on `127.0.0.1`).
- **IPv4 only**: Check `0.0.0.0` and `127.0.0.1` to avoid IPv6 dual-stack complications
- **Deterministic order**: Ports allocated in config declaration order for reproducibility

### Port Reuse from Lockfile

When lockfile exists and `--force` not specified:

1. Load ports from lockfile
2. Verify each port is still free
3. If any port is occupied, reallocate only that port (keep others stable)
4. Update lockfile with new allocation

## Lifecycle Operations

### `silo init`

1. Resolve config path (default: `silo.toml`, overridable via `-c/--config`)
2. If the config file already exists: error with a clear message
3. Write a starter `silo.toml` template
4. Print banner + short intro + Fallout-style quote + quick explainer
5. Print next-step hint (`silo up`)

Starter config template:

```toml
# Generated by silo init
# Docs: silo doc config

version = 1

[ports]
WEB_PORT = 3000
API_PORT = 8080
REDIS_PORT = 6379
TILT_PORT = 10350

[hosts]
APP_HOST = "${name}.localhost"
API_HOST = "api.${name}.localhost"

# Optional k3d integration (uncomment to enable)
# [k3d]
# enabled = true
#
# [k3d.registry]
# enabled = true
```

Init output (example):

```
      __               ____  _ _
     /  \             / ___|| (_) ___
    /____\            \___ \| | |/ _ \
    | [] |             ___) | | | (_) |
    |    |            |____/|_|_|\___/
    |    |
    |____|
~~~~|____|~~~~~

silo init - isolate your dev worlds.

"War. War never changes. But your localhost can." - Silo Overseer

silo generates a silo.toml that defines ports, hosts, and optional k3d settings.
Next: edit the file, then run `silo up`.
```

### `silo up [name]`

1. Load config from silo.toml
2. Validate required tools exist (tilt, janitor; k3d if configured after profile merge)
3. Resolve profile (--profile flag -> SILO_PROFILE env -> lockfile profile -> none)
4. If lockfile exists with different profile and no --force: error
5. Merge profile overrides with base config
6. Check if instance already running -> report it and exit 0 (or disown it
   under `--force`; see [Instance State Detection](#instance-state-detection))
7. Resolve instance name (CLI arg -> lockfile -> auto-generate)
8. Allocate ports (profile ports merged with base, then allocated)
9. Generate env file (includes SILO_PROFILE)
10. Write lockfile (includes profile)
11. Run `pre-up` hooks (base + profile.append merged)
12. If k3d configured (after profile merge):
    - Create k3d cluster with instance-specific name
    - Create registry if configured
    - Write kubeconfig to instance-specific path
    - Advertise registry via `local-registry-hosting` ConfigMap (Tilt auto-discovery)
13. Run `post-up` hooks (base + profile.append merged)
14. Start Tilt in foreground, supervised (see [Process supervision](#process-supervision))
    - Write the supervisor's `tiltPid` and `tiltStartedAt` to lockfile
15. On Ctrl+C or Tilt exit:
    - Clear `tiltPid` from lockfile (indicates clean shutdown)
    - Proceed to cleanup (if needed)

## Process supervision

silo runs Tilt as `janitor --grace-ms <ms> -- tilt up` rather than spawning
`tilt up` directly.

**Invariant: Tilt does not outlive the silo process that started it.**

`silo up` forwards SIGINT and SIGTERM to Tilt, which covers an orderly exit.
It cannot cover the cases where no handler runs at all -- SIGKILL, SIGHUP when
the controlling terminal closes, or a silo crash. Tilt would then reparent to
init and keep holding the instance's allocated ports. Because silo allocates a
distinct port per instance, such orphans never collide with a later `silo up`
and accumulate unnoticed.

janitor watches its parent and, when silo goes away, drains Tilt's process
group with SIGTERM, a grace window, then SIGKILL.

Consequences:

- janitor is a required tool, validated in step 2 of `silo up`. A missing
  supervisor fails the run rather than silently starting an unsupervised Tilt.
- `tiltPid` in the lockfile is the **supervisor's** pid, not tilt's. It is the
  process silo spawned and the one `silo down` stops; stopping it drains Tilt.
  `silo status` and `silo down` therefore accept either the supervisor or tilt
  as the tracked process.

### `silo down`

1. Read lockfile for current instance
2. Run `pre-down` hooks
3. Run `tilt down` (best-effort cleanup of resources)
4. Stop Tilt if running
5. k3d cluster is **kept by default** (faster iteration)
   - Use `silo down --delete-cluster` to remove k3d cluster
6. Run `post-down` hooks
7. Env file and lockfile are kept (for `silo up` to reuse ports)
   - Use `silo down --clean` to remove them

### `silo status`

1. Read lockfile
2. Check if Tilt process running
3. Check if k3d cluster exists
4. Display summary:
   ```
   Instance: feature-x
   Profile: testnet-local
   State: running
   Tilt: pid 12345
   k3d: localnet-feature-x (running)
   Ports:
     WEB_PORT: 3000
     API_PORT: 8080
   URLs:
     WEB_URL: http://feature-x.localhost:3000
   ```

### `silo env [name]`

1. Load config
2. Resolve profile (--profile flag -> SILO_PROFILE env -> lockfile profile -> none)
3. Merge profile overrides with base config
4. Resolve instance name
5. Allocate ports
6. Generate env file (includes SILO_PROFILE if profile active)
7. Write lockfile (includes profile)
8. Print ports and URLs
9. Exit (don't start anything)

### `silo profiles`

1. Load config from silo.toml
2. If no `[profiles]` section: print "No profiles defined"
3. List profile names (one per line)
4. Example output:
   ```
   Available profiles:
     localnet
     testnet-local
     devnet-local
   ```

### `silo doc [topic]`

1. If no topic provided, list available docs
2. Print the requested doc in raw markdown (no extra formatting)

## Logging

silo prints progress logs for each command to show what it's doing. There is no quiet mode.

**Default (info) logs**:
- Major lifecycle steps (config load, name resolution, port allocation, k3d, hooks, Tilt)
- Actions taken (env/lockfile written, cluster created/reused, Tilt started)
- Summaries (ports/URLs for `silo env`, status summary for `silo status`)

**Verbose mode** (`-v/--verbose`) adds:
- Config path used
- Extra details about decisions (port reuse, lockfile reuse)

## Name Resolution

Instance names are resolved in order:

1. **Explicit CLI argument**: `silo up my-feature`
2. **Existing lockfile**: If `.silo.lock` exists, reuse its name
3. **Auto-generate**: `{directory}-{random}` (e.g., `myproject-a3f7`)

Auto-generation:

- Takes current directory basename
- Appends 4-character random suffix (lowercase alphanumeric)
- Sanitizes result (lowercase, alphanumeric + dashes, max 63 chars)

```typescript
function generateName(): string {
  const dir = basename(process.cwd());
  const suffix = randomString(4); // e.g., 'a3f7'
  return sanitizeName(`${dir}-${suffix}`);
}
```

This ensures:

- Zero-config first run (`silo up` just works)
- Stable name on subsequent runs (lockfile persists it)
- Uniqueness across multiple clones of same repo

## Lifecycle Hooks

Hooks run shell commands at lifecycle points:

```toml
[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-db.sh"]
pre-down = ["./scripts/backup-state.sh"]
post-down = []
```

**Execution:**

- Commands run sequentially in order listed
- Working directory is project root (where silo.toml lives)
- Environment includes all generated variables (ports, identity, URLs)
- Hooks inherit silo's stdout/stderr

**Failure handling:**

- If a hook exits non-zero, silo stops and reports the failure
- `pre-up` failure: Abort before k3d created (env/lockfile already written, can be reused)
- `post-up` failure: k3d exists but Tilt not started (user runs `silo down` to clean up)
- `pre-down` failure: Abort teardown, all resources remain
- `post-down` failure: Log warning, continue (resources already removed)

**Hook order in lifecycle:**

```
silo up:
  1. Load config, resolve name
  2. Allocate ports, generate env
  3. Run pre-up hooks
  4. Create k3d cluster (if configured)
  5. Run post-up hooks
  6. Start Tilt (foreground)

silo down:
  1. Run pre-down hooks
  2. Stop Tilt
  3. Delete k3d cluster (if --delete-cluster)
  4. Run post-down hooks
  5. Clean files (if --clean)
```

## Error Handling

- **Fail fast, manual cleanup**: Stop on first error. User runs `silo down` to clean up.
- **Tool validation**: Check tilt/k3d exist before starting. Provide clear error if missing.
- **Port conflicts**: Log which ports conflicted, show allocated alternatives.

### Instance State Detection

**"Already running" detection** (checked in `silo up`, before ports, hooks or
k3d are touched):

1. Lockfile exists with `tiltPid` set
2. Process with that PID is still running
3. Process is actually Tilt or its supervisor (check process name)

If all three, `silo up` is a no-op: it reports the running instance, its ports
and its URLs, and exits 0. `up` is therefore idempotent -- a second `up` never
forks a second stack, which would come up silently on ephemeral ports and leave
two Tilts answering for one project.

The check runs under an exclusive startup claim (`.silo.startup`, holding the
starting process's pid). The lockfile can only answer for a Tilt that has
already been recorded, so two `silo up` invocations racing through preparation
would both see no live Tilt; the claim is what serializes that window. A claim
whose owner is gone is reclaimed automatically.

If nothing owns the lockfile but a disowned stack is still running -- a
`--force` handover that failed partway, or a replacement that has since exited
-- `silo up` errors with `DISOWNED_RUNNING` naming those stacks rather than
starting beside them silently. Stop them, or pass `--force`.

A reuse only happens when the live instance is the one being asked for. If the
run names a different instance (`silo up other-name`) or a different profile
(`--profile`/`SILO_PROFILE`), `silo up` errors with `ALREADY_RUNNING` naming
what is actually running, rather than reporting success for something else.

`silo up --force` overrides this for a deliberate parallel stack. The running
pid moves from `tiltPid` into `disownedTilts` in the same lockfile write that
gives the replacement stack its ports, so a failure before that write leaves the
running stack owning the lockfile, and a failure after it leaves the stack
recorded as disowned -- which is what the `DISOWNED_RUNNING` guard above then
refuses to start beside. A disowned stack keeps a record of the ports
it owns, which stay reserved in the machine-wide port registry; it is reported
by `silo status`, is not stopped by `silo down`, and is dropped from the
lockfile when it exits (or on the next `silo up`/`silo down` if silo was killed
before it could).

`silo ci` still errors with "Instance '{name}' already running. Use `silo down`
first." -- a CI run has no interactive owner to reuse an environment for.

**"External Tilt" detection**:

1. Collect Tilt-named candidate processes (`pgrep -f tilt`, then filtered by
   command name).
2. Keep the ones whose working directory is the project root. A process's
   directory is not part of its argv -- silo passes the project root as the
   spawn cwd, and a developer's own `tilt up` is just `tilt up` -- so each
   candidate's cwd is read from the system (`/proc/<pid>/cwd` on Linux, `lsof`
   elsewhere). A cwd that cannot be read means "unknown", and the process is
   not treated as a match.
3. Discard anything belonging to a stack silo started: a recorded pid, a
   descendant of one (the supervisor runs `tilt up` as a child, in a process
   group of its own), or a process in the group a recorded pid leads.
4. If anything remains: error with "Tilt already running outside silo (pid N).
   Stop it first."

### Missing Lockfile Behavior

`silo down --clean` refuses with `DISOWNED_RUNNING` while a disowned stack is
still running: removing the lockfile would erase the only record of those pids
and release the ports they still answer on.

| Command           | Lockfile Missing | Behavior                                                 |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `silo up`         | OK               | Auto-generates name, normal startup, creates lockfile    |
| `silo up <name>`  | OK               | Uses provided name, normal startup, creates lockfile     |
| `silo down`       | Error            | "No lockfile found. Nothing to stop."                    |
| `silo status`     | OK               | "No active instance. Run `silo up` to start."            |
| `silo env`        | OK               | Auto-generates name, normal generation, creates lockfile |
| `silo env <name>` | OK               | Uses provided name, normal generation, creates lockfile  |

## k3d Integration

silo calls k3d directly (not ctlptl). Instance isolation includes:

- **Cluster name**: `{prefix}-{name}` (e.g., `localnet-feature-x`)
- **Registry**: `{prefix}-{name}-registry.localhost:{port}`
- **Kubeconfig**: Separate file per instance at `~/.kube/{prefix}-{name}`

If `{prefix}-{name}` exceeds 32 characters, silo shortens the k3d cluster name
to stay within the limit while preserving uniqueness. The format becomes:

```
{prefixPart}-{hash}-{suffix}
```

- `hash` is the first 8 hex chars of a SHA-256 of the full name
- `suffix` is the last 6 chars of the final dash-delimited segment

The shortened name is used for the cluster, registry, and kubeconfig path.

Creation command (assembled from config + allocated ports):

```bash
k3d cluster create localnet-feature-x \
  --kubeconfig-update-default=false \
  --kubeconfig-switch-context=false \
  --registry-create localnet-feature-x-registry.localhost:5000 \
  --agents=2 \
  --port=8080:80@loadbalancer \
  --port=8443:443@loadbalancer

# Write kubeconfig
k3d kubeconfig get localnet-feature-x > ~/.kube/localnet-feature-x
```

Note: Registry port (`5000` above) comes from allocated `K3D_REGISTRY_PORT`.

Deletion:

```bash
k3d cluster delete localnet-feature-x
```

### Registry Discovery (Tilt Auto-Detection)

To make registry usage seamless, silo advertises the local registry using the Kubernetes
standard `local-registry-hosting` ConfigMap in the `kube-public` namespace. Tilt reads
this ConfigMap and automatically discovers the registry without `default_registry()` or
explicit image refs.

Applied after cluster + registry creation:

```bash
cat <<EOF | KUBECONFIG=~/.kube/localnet-feature-x kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:5000"
    hostFromContainerRuntime: "localnet-feature-x-registry.localhost:5000"
    hostFromClusterNetwork: "localnet-feature-x-registry.localhost:5000"
EOF
```

Notes:

- `host` must match the registry address reachable from the **developer machine**.
- Override fields via `k3d.registry.*` (host/hostFrom*/help) when defaults aren't correct.
- External clusters can use top-level `[registry]` to advertise without k3d.
- `hostFromContainerRuntime` is the address that the **node runtime** uses to pull images.
- `hostFromClusterNetwork` is the address that **pods in the cluster** can use if needed.
- `help` is optional and may point to project-specific registry docs.
- This is written only when `k3d.registry.enabled = true`.

## Browser Isolation

Different ports on `localhost` share cookies. Solution: subdomain isolation.

```
http://main.localhost:3000      -> separate cookies
http://feature-x.localhost:3001 -> separate cookies
```

Chrome/Edge treat `*.localhost` as 127.0.0.1 automatically. No `/etc/hosts` needed.

### Host Configuration

Hosts are defined in `silo.toml` with `${name}` placeholder:

```toml
# Simple (single host)
[hosts]
APP_HOST = "${name}.localhost"

# Multi-service (separate cookies per service)
[hosts]
APP_HOST = "${name}.localhost"
ADMIN_HOST = "admin.${name}.localhost"
API_HOST = "api.${name}.localhost"
```

**Default** (if `[hosts]` omitted):

```toml
[hosts]
APP_HOST = "${name}.localhost"
```

**Built-in hosts** (always added to `hosts` record):

- `TILT_HOST`: Copies `APP_HOST` value (for Tilt UI access at `http://${TILT_HOST}:${TILT_PORT}`)

**Resolution**: `${name}` is replaced with the sanitized instance name.

- Instance: `feature-x` → `APP_HOST=feature-x.localhost`
- Instance: `feature-x` → `ADMIN_HOST=admin.feature-x.localhost`

All host variables are available for URL templates:

```toml
[urls]
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"
ADMIN_URL = "http://${ADMIN_HOST}:${ADMIN_PORT}"
```

## Tilt Integration

**Tiltfile location**: Expected in current directory. User runs `silo up` from project root.

**Environment passing**: silo does both:

1. Sources env file before running tilt (`source .localnet.env && tilt up`)
2. Writes env file that Tiltfile can read directly (`read_file('.localnet.env')`)

Projects can use either approach in their Tiltfile.

**Registry discovery**: When `k3d.registry.enabled = true`, silo writes the
`local-registry-hosting` ConfigMap so Tilt can auto-detect the local registry
without `default_registry()`. This avoids conflicts with `docker_compose()` and
keeps k8s image names simple.

## Non-Goals

- **No remote deploys**: Local development only. No staging/prod.
- **No config generation**: silo doesn't generate Tiltfile or compose.yaml. Projects own those.
- **No secrets management**: No vault/secrets integration. Use direnv or similar.
- **No compose management**: Tilt manages compose via `docker_compose()`. silo only sets env vars.
- **No Tilt API wrap**: silo starts and stops Tilt; resource health, logs, and
  triggers stay `tilt get` / `tilt logs` / `tilt trigger` against the API
  server (`--port $TILT_PORT`).

## Success Criteria

1. **Two instances run simultaneously**: Two worktrees of the same project run without port/volume/auth conflicts
2. **Clean bootstrap**: `git clone && silo up dev` works without manual k3d/registry setup
3. **Isolation verified**: Different instances have:
   - Different ports (verified by env file)
   - Different k3d clusters (verified by `k3d cluster list`)
   - Different browser cookies (verified by `*.localhost` hostnames)

## Example Project

A runnable example lives in `example/` to demonstrate and verify silo features.

### Structure

```
example/
  silo.toml           # silo configuration
  Tiltfile            # Tilt orchestration (includes inline k8s manifests)
  docker-compose.yaml # Redis service definition
  api/
    server.ts         # Simple Bun API server
    Dockerfile        # Container build
  web/
    server.ts         # Simple Bun web server
    Dockerfile        # Container build
  scripts/
    check-deps.sh     # pre-up hook: verify docker, k3d installed
    seed-data.sh      # post-up hook: insert test data
```

### Example Configuration

```toml
# example/silo.toml
version = 1
# prefix defaults to "localnet" - not overridden here to avoid
# double-naming with auto-generated names from directory

[ports]
WEB_PORT = 3000
API_PORT = 8080
REDIS_PORT = 6379
TILT_PORT = 10350
K3D_REGISTRY_PORT = 5000
K3D_LB_HTTP_PORT = 8880
K3D_LB_HTTPS_PORT = 8443

[hosts]
APP_HOST = "${name}.localhost"
API_HOST = "api.${name}.localhost"

[urls]
WEB_URL = "http://${APP_HOST}:${WEB_PORT}"
API_URL = "http://${API_HOST}:${API_PORT}"
REDIS_URL = "redis://localhost:${REDIS_PORT}"

[k3d]
enabled = true
args = [
  "--agents=1",
  "--port=${K3D_LB_HTTP_PORT}:80@loadbalancer",
  "--port=${K3D_LB_HTTPS_PORT}:443@loadbalancer",
]

[k3d.registry]
enabled = true

[hooks]
pre-up = ["./scripts/check-deps.sh"]
post-up = ["./scripts/seed-data.sh"]

# Profile: remote-api (connect to external API instead of local)
[profiles.remote-api]
urls.API_URL = "https://api.staging.example.com"
k3d.enabled = false  # No local cluster needed

[profiles.remote-api.append]
hooks.post-up = ["./scripts/configure-remote.sh"]
```

### Example Tiltfile

```python
load('ext://dotenv', 'dotenv')
dotenv('.localnet.env')
load('./tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
# Or, in CI after installing @0xbigboss/silo as a dependency:
# load('./node_modules/@0xbigboss/silo/tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')
# Or, if using a GitHub-hosted extension repo:
# v1alpha1.extension_repo(name='default', url='https://github.com/<org>/<tilt-extensions-repo>')
# load('ext://silo/require', 'SILO_REQUIRE')

# Read env vars for registry and ports
web_port = os.getenv('WEB_PORT', '3000')
api_port = os.getenv('API_PORT', '8080')
redis_port = os.getenv('REDIS_PORT', '6379')
app_host = os.getenv('APP_HOST', 'localhost')
workspace_name = os.getenv('WORKSPACE_NAME', 'unknown')

# Redis via docker-compose (simpler for stateful services)
docker_compose('docker-compose.yaml')
dc_resource('redis', labels=['backend'])

# Web + API services via k8s (demonstrates k3d cluster usage)
# Tilt will auto-discover the local registry via local-registry-hosting.
docker_build(
  'web',
  './web',
  live_update=[
    sync('./web', '/app'),
  ]
)

docker_build(
  'api',
  './api',
  live_update=[
    sync('./api', '/app'),
  ]
)

# Apply k8s manifests with env var substitution
k8s_yaml(blob("""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: web
          ports:
            - containerPort: 3000
          env:
            - name: REDIS_URL
              value: "redis://host.docker.internal:{REDIS_PORT}"
            - name: API_URL
              value: "http://api:8080"
            - name: APP_HOST
              value: "{APP_HOST}"
            - name: WORKSPACE_NAME
              value: "{WORKSPACE_NAME}"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: api
          ports:
            - containerPort: 8080
          env:
            - name: WORKSPACE_NAME
              value: "{WORKSPACE_NAME}"
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app: api
  ports:
    - port: 8080
      targetPort: 8080
""".format(
  REDIS_PORT=redis_port,
  APP_HOST=app_host,
  WORKSPACE_NAME=workspace_name,
)))

k8s_resource(
  'api',
  port_forwards=['{}:8080'.format(api_port)],
  labels=['backend']
)

k8s_resource(
  'web',
  port_forwards=['{}:3000'.format(web_port)],
  labels=['frontend'],
  resource_deps=['redis', 'api']
)
```

### Example docker-compose.yaml

```yaml
# example/docker-compose.yaml
# Redis runs via docker-compose (simpler for local stateful services)
services:
  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT}:6379"
```

### Example Web Server

```typescript
// example/web/server.ts
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "unknown";

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", host });
    }

    if (url.pathname === "/") {
      const apiUrl = process.env.API_URL ?? "unknown";
      return new Response(
        `
        <html>
          <body>
            <h1>silo Example</h1>
            <p>Host: ${host}</p>
            <p>Instance: ${process.env.WORKSPACE_NAME}</p>
            <p>Ports: WEB=${process.env.WEB_PORT}, API=${process.env.API_PORT}</p>
            <p>API URL: ${apiUrl}</p>
          </body>
        </html>
      `,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Server running on port ${server.port}`);
```

### Example API Server

```typescript
// example/api/server.ts
const server = Bun.serve({
  port: 8080,
  fetch(req) {
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? "unknown";

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "api", host });
    }

    if (url.pathname === "/") {
      return Response.json({
        service: "api",
        host,
        instance: process.env.WORKSPACE_NAME,
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`API server running on port ${server.port}`);
```

### Running the Example

```bash
cd example

# First run: generates name (example-a3f7), creates k3d cluster, starts Tilt
# Name: directory "example" + random suffix "a3f7" -> "example-a3f7"
# Cluster: prefix "localnet" + name -> "localnet-example-a3f7"
silo up
# Output:
#   Instance: example-a3f7
#   Creating k3d cluster 'localnet-example-a3f7'...
#   Creating registry 'localnet-example-a3f7-registry.localhost:5000'...
#   Writing kubeconfig to ~/.kube/localnet-example-a3f7
#   Starting Tilt...
# Opens Tilt UI at http://example-a3f7.localhost:10350

# In another terminal, verify k3d cluster exists
k3d cluster list
# NAME                     SERVERS   AGENTS   LOADBALANCER
# localnet-example-a3f7    1/1       1/1      true

# Verify registry exists
k3d registry list
# NAME                                          ROLE       CLUSTER
# localnet-example-a3f7-registry.localhost      registry   localnet-example-a3f7

# Verify pods are running in k3d cluster
KUBECONFIG=~/.kube/localnet-example-a3f7 kubectl get pods
# NAME                   READY   STATUS    RESTARTS   AGE
# web-5d4f8b7c9f-x2k4j   1/1     Running   0          30s
# api-7b9c6f8d2c-9n8k1   1/1     Running   0          30s

# Verify web service responds (via Tilt port-forward)
curl http://example-a3f7.localhost:3000/health
# {"status":"ok","host":"example-a3f7.localhost:3000"}

# Check status
silo status
# Instance: example-a3f7
# State: running
# Tilt: pid 12345
# k3d: localnet-example-a3f7 (running)
# Registry: localnet-example-a3f7-registry.localhost:5000
# Kubeconfig: ~/.kube/localnet-example-a3f7
# Ports:
#   WEB_PORT: 3000
#   API_PORT: 8080
#   REDIS_PORT: 6379
#   K3D_REGISTRY_PORT: 5000
#   K3D_LB_HTTP_PORT: 8880

# Stop Tilt but keep k3d cluster (faster restart)
silo down

# Restart - reuses existing k3d cluster
silo up
# Output: Reusing k3d cluster 'localnet-example-a3f7'

# Full cleanup including k3d cluster
silo down --delete-cluster
# Output:
#   Stopping Tilt...
#   Deleting k3d cluster 'localnet-example-a3f7'...
#   Done

# Run second instance (simulating another worktree)
silo up second
# Creates separate k3d cluster 'localnet-second'
# If port 5000 occupied: K3D_REGISTRY_PORT allocates to 49152
# Fully isolated from first instance

# List available profiles
silo profiles
# Available profiles:
#   remote-api

# Run with remote-api profile (no k3d, uses external API)
silo up --profile remote-api
# Output:
#   Instance: example-a3f7
#   Profile: remote-api
#   k3d: disabled by profile
#   API_URL: https://api.staging.example.com
#   Starting Tilt...

# Check status shows active profile
silo status
# Instance: example-a3f7
# Profile: remote-api
# State: running
# ...

# Subsequent runs remember profile from lockfile
silo up
# Output: Reusing profile 'remote-api' from lockfile

# Switch back to base config (no profile) requires --force
silo up --force
# Output: Cleared profile, using base config
```

### Feature Verification Checklist

The example verifies these silo features:

| Feature                  | Verification                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| **Port allocation**      | `silo status` shows allocated ports match env file               |
| **Name generation**      | First `silo up` creates name from directory + suffix             |
| **Name reuse**           | Second `silo up` (no arg) reuses lockfile name                   |
| **Host isolation**       | Browser at `http://{name}.localhost:3000` shows correct instance |
| **Env file**             | `.localnet.env` contains all expected variables                  |
| **Lockfile**             | `.silo.lock` persists instance state                             |
| **k3d cluster creation** | `k3d cluster list` shows instance-named cluster                  |
| **k3d registry**         | `k3d registry list` shows instance-named registry                |
| **Isolated kubeconfig**  | `~/.kube/{prefix}-{name}` exists and works                       |
| **k8s pods running**     | `kubectl get pods` shows web and api pods in Running state       |
| **Registry push**        | Tilt builds and pushes to instance registry                      |
| **k3d cluster reuse**    | Second `silo up` reuses existing cluster                         |
| **k3d cluster delete**   | `silo down --delete-cluster` removes cluster                     |
| **Pre-up hook**          | `check-deps.sh` runs before k3d created                          |
| **Post-up hook**         | `seed-data.sh` runs after k3d ready                              |
| **Tilt foreground**      | Ctrl+C in silo stops Tilt cleanly                                |
| **Down command**         | `silo down` stops Tilt, keeps k3d                                |
| **Down --clean**         | `silo down --clean` removes env and lockfile                     |
| **Multiple instances**   | Two instances have separate k3d clusters, registries, ports      |
| **Duplicate up**         | Second `silo up` reports the live instance and exits 0           |
| **Forced parallel up**   | `silo up --force` records the running stack in `disownedTilts`  |
| **Profile list**         | `silo profiles` shows available profiles                         |
| **Profile activation**   | `silo up --profile X` applies profile overrides                  |
| **Profile persistence**  | Lockfile stores active profile for reuse                         |
| **Profile in env**       | `.localnet.env` contains `SILO_PROFILE` variable                 |
| **Profile switching**    | Changing profile requires `--force` flag                         |
| **Profile URL override** | Profile can override base URL values                             |
| **Profile k3d toggle**   | Profile can disable k3d even when base has it enabled            |
| **Profile hook append**  | `[profiles.x.append]` adds to base hooks                         |

### Integration Test Script

```bash
#!/bin/bash
# Automated verification of silo features

set -euo pipefail

SILO_BIN="${SILO_BIN:-silo}"

cd "$(dirname "$0")"

INSTANCE_NAME="test-$$"  # Unique per run
CLUSTER_NAME="localnet-${INSTANCE_NAME}"  # prefix + name

cleanup() {
  echo "=== Cleanup ==="
  $SILO_BIN down --delete-cluster --clean 2>/dev/null || true
  rm -f .localnet.env .silo.lock
}
trap cleanup EXIT

echo "=== Test: Fresh start ==="
rm -f .localnet.env .silo.lock
$SILO_BIN env "$INSTANCE_NAME"
[ -f .localnet.env ] || (echo "FAIL: env file not created"; exit 1)
[ -f .silo.lock ] || (echo "FAIL: lockfile not created"; exit 1)
grep -q "WORKSPACE_NAME=${INSTANCE_NAME}" .localnet.env || (echo "FAIL: wrong name"; exit 1)
echo "PASS: Fresh start"

echo "=== Test: Name reuse ==="
rm -f .localnet.env
$SILO_BIN env
grep -q "WORKSPACE_NAME=${INSTANCE_NAME}" .localnet.env || (echo "FAIL: name not reused"; exit 1)
echo "PASS: Name reuse"

echo "=== Test: Port allocation ==="
grep -q "WEB_PORT=" .localnet.env || (echo "FAIL: WEB_PORT not set"; exit 1)
grep -q "API_PORT=" .localnet.env || (echo "FAIL: API_PORT not set"; exit 1)
grep -q "K3D_REGISTRY_PORT=" .localnet.env || (echo "FAIL: K3D_REGISTRY_PORT not set"; exit 1)
echo "PASS: Port allocation"

echo "=== Test: Host generation ==="
grep -q "APP_HOST=${INSTANCE_NAME}.localhost" .localnet.env || (echo "FAIL: APP_HOST wrong"; exit 1)
grep -q "API_HOST=api.${INSTANCE_NAME}.localhost" .localnet.env || (echo "FAIL: API_HOST wrong"; exit 1)
echo "PASS: Host generation"

echo "=== Test: URL interpolation ==="
grep -q "WEB_URL=http://${INSTANCE_NAME}.localhost:" .localnet.env || (echo "FAIL: WEB_URL wrong"; exit 1)
echo "PASS: URL interpolation"

echo "=== Test: k3d cluster creation ==="
# Start silo in background for k3d test
$SILO_BIN up "$INSTANCE_NAME" &
SILO_PID=$!

wait_for() {
  local description=$1
  local timeout=$2
  local command=$3
  local interval=2
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if eval "$command"; then
      return 0
    fi
    sleep $interval
    elapsed=$((elapsed + interval))
  done
  echo "FAIL: timeout waiting for ${description}"
  return 1
}

wait_for "k3d cluster" 60 "k3d cluster list | grep -q \"$CLUSTER_NAME\"" || (kill $SILO_PID 2>/dev/null; exit 1)

k3d cluster list | grep -q "$CLUSTER_NAME" || (echo "FAIL: k3d cluster not created"; kill $SILO_PID 2>/dev/null; exit 1)
echo "PASS: k3d cluster creation"

echo "=== Test: k3d registry ==="
k3d registry list | grep -q "${CLUSTER_NAME}-registry" || (echo "FAIL: k3d registry not created"; kill $SILO_PID 2>/dev/null; exit 1)
echo "PASS: k3d registry"

echo "=== Test: Isolated kubeconfig ==="
KUBECONFIG_PATH=$(grep "KUBECONFIG=" .localnet.env | cut -d= -f2)
wait_for "kubeconfig file" 60 "test -f \"$KUBECONFIG_PATH\"" || (echo "FAIL: kubeconfig not created"; kill $SILO_PID 2>/dev/null; exit 1)
echo "PASS: Isolated kubeconfig"

echo "=== Test: k8s pods running ==="
wait_for "web pod running" 120 "KUBECONFIG=\"$KUBECONFIG_PATH\" kubectl get pods | grep -q \"web.*Running\"" || (echo "FAIL: web pod not running"; kill $SILO_PID 2>/dev/null; exit 1)
wait_for "api pod running" 120 "KUBECONFIG=\"$KUBECONFIG_PATH\" kubectl get pods | grep -q \"api.*Running\"" || (echo "FAIL: api pod not running"; kill $SILO_PID 2>/dev/null; exit 1)
echo "PASS: k8s pods running"

echo "=== Test: Stop silo ==="
kill $SILO_PID 2>/dev/null || true
wait $SILO_PID 2>/dev/null || true

echo "=== Test: k3d cluster preserved after down ==="
k3d cluster list | grep -q "$CLUSTER_NAME" || (echo "FAIL: cluster deleted on regular down"; exit 1)
echo "PASS: k3d cluster preserved"

echo "=== Test: k3d cluster deletion ==="
$SILO_BIN down --delete-cluster
k3d cluster list | grep -q "$CLUSTER_NAME" && (echo "FAIL: cluster not deleted"; exit 1)
echo "PASS: k3d cluster deletion"

echo "=== Test: --clean removes env and lockfile ==="
# Recreate files first
$SILO_BIN env "$INSTANCE_NAME"
[ -f .localnet.env ] || (echo "FAIL: env file not recreated"; exit 1)
[ -f .silo.lock ] || (echo "FAIL: lockfile not recreated"; exit 1)
# Now test --clean
$SILO_BIN down --clean
[ -f .localnet.env ] && (echo "FAIL: env file not removed by --clean"; exit 1)
[ -f .silo.lock ] && (echo "FAIL: lockfile not removed by --clean"; exit 1)
echo "PASS: --clean removes env and lockfile"

echo "All tests passed!"
```

## Decisions Log

All design decisions were made through interview. Key choices:

**Tech Stack:**

- **Runtime**: Bun (latest stable)
- **Config format**: TOML (`silo.toml`)
- **Distribution**: Bun single-file executable
- **Tooling**: oxlint, oxformat, knip, jscpd, lefthook

**Architecture:**

- **Port allocation**: Default-first (try configured port, fall back to ephemeral)
- **k3d registry port**: Allocated like other ports via `ports.K3D_REGISTRY_PORT`
- **Lifecycle scope**: Includes up/down/status/env commands
- **Tilt required**: silo assumes Tilt; compose-only projects use docker-compose directly
- **Compose handling**: Tilt manages compose via `docker_compose()`, silo doesn't touch it
- **k3d method**: Call k3d directly, not ctlptl
- **k3d on down**: Keep by default, `--delete-cluster` to remove
- **Config defaults**: `prefix`, `output`, `hosts`, `urls` all optional with sensible defaults
- **Template syntax**: Shell-style `${VAR}` with phased resolution (identity → hosts → ports → urls)
- **Name resolution**: CLI arg -> lockfile -> auto-generate (directory + random suffix)
- **Tilt process**: Foreground, Ctrl+C stops; tiltPid tracked in lockfile
- **Error handling**: Fail fast, manual cleanup; explicit missing lockfile behavior
- **Extensibility**: Lifecycle hooks (pre/post up/down)

**Profiles:**

- **Default behavior**: No `--profile` flag uses base config directly (implicit base, no explicit default profile)
- **Override scope**: Profiles can override any config section (ports, hosts, urls, k3d, hooks)
- **Port overrides**: Profile ports go through normal allocation (try value, fall back to ephemeral)
- **Profile persistence**: Lockfile stores active profile; subsequent `silo up` reuses it
- **Profile switching**: Requires `--force` flag to change profiles (prevents accidental switches)
- **Inheritance**: None - each profile merges only with base config (no profile chains)
- **New variables**: Profiles can introduce variables not defined in base config
- **Missing profiles**: Error if `--profile` used but no profiles defined in silo.toml
- **Env output**: `SILO_PROFILE` variable added to env file when profile active
- **Child process env**: `SILO_ACTIVE`, `SILO_WORKSPACE`, `SILO_ENV_FILE` exported to spawned processes
- **Array merge**: Default replace; `[profiles.x.append]` section for appending to arrays
- **k3d toggle**: Profiles can enable/disable k3d
- **Env var**: SILO_PROFILE env var supported; `--profile` flag takes precedence

## Tech Stack

### Runtime & Language

- **Runtime**: Bun (latest stable)
- **Language**: TypeScript (strict mode)
- **Distribution**: Bun single-file executable via `bun build --compile`

### Bun APIs Used

| Purpose       | API                              | Notes                               |
| ------------- | -------------------------------- | ----------------------------------- |
| File I/O      | `Bun.file()`, `Bun.write()`      | Read/write config, env, lockfile    |
| Process spawn | `Bun.spawn()`, `Bun.spawnSync()` | Run k3d, tilt, hooks                |
| Port check    | `Bun.listen()`                   | TCP bind test for port availability |
| CLI args      | `process.argv`, `Bun.argv`       | Argument parsing                    |
| Signals       | `process.on('SIGINT')`           | Handle Ctrl+C                       |
| Shell         | `Bun.$` (shell API)              | Run hook scripts                    |
| Environment   | `process.env`                    | Read/set env vars                   |

### Configuration Format

**TOML** (not YAML) for configuration files:

- File: `silo.toml`
- Parser: `@iarna/toml` or Bun-native if available

### Development Tooling

| Tool         | Purpose                          | Config File       |
| ------------ | -------------------------------- | ----------------- |
| **oxlint**   | Linting (fast, Rust-based)       | `oxlintrc.json`   |
| **oxformat** | Formatting (companion to oxlint) | Via oxlint config |
| **knip**     | Dead code/dependency detection   | `knip.json`       |
| **jscpd**    | Copy-paste detection             | `.jscpd.json`     |
| **lefthook** | Git hooks (pre-commit, pre-push) | `lefthook.yml`    |

### Build & Distribution

```bash
# Development
bun run dev           # Run with watch mode
bun run lint          # oxlint
bun run format        # oxformat
bun run check         # knip + jscpd

# Build single-file executable
bun build --compile --minify --outfile dist/silo src/cli.ts

# Cross-platform builds
bun build --compile --target=linux-x64 --outfile dist/silo-linux-x64 src/cli.ts
bun build --compile --target=darwin-arm64 --outfile dist/silo-darwin-arm64 src/cli.ts
bun build --compile --target=darwin-x64 --outfile dist/silo-darwin-x64 src/cli.ts
```

### Lefthook Configuration

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,tsx}"
      run: bunx oxlint {staged_files}
    format:
      glob: "*.{ts,tsx,json,toml}"
      run: bunx oxformat --check {staged_files}
    typecheck:
      run: bun run tsc --noEmit

pre-push:
  commands:
    test:
      run: bun test
    knip:
      run: bunx knip
    jscpd:
      run: bunx jscpd src/
```

## CLI Architecture

### Directory Structure

```
src/
  cli.ts              # Entry point, argument parsing
  commands/
    init.ts           # silo init implementation
    doc.ts            # silo doc implementation
    up.ts             # silo up implementation
    down.ts           # silo down implementation
    status.ts         # silo status implementation
    env.ts            # silo env implementation
docs/
  silo-toml.md        # silo.toml reference (bundled with CLI)
  core/
    config.ts         # Load and validate silo.toml
    name.ts           # Name resolution
    identity.ts       # Generate instance identity
    ports.ts          # Port allocation
    hosts.ts          # Host template resolution
    env.ts            # Generate env file content
    lockfile.ts       # Read/write lockfile
  backends/
    k3d.ts            # k3d cluster create/delete
    tilt.ts           # Start tilt, handle signals
  hooks/
    runner.ts         # Execute lifecycle hooks
  utils/
    validate.ts       # Check required tools exist
    logger.ts         # Structured logging
    errors.ts         # Error types and handling
```

### CLI Entry Point Pattern

```typescript
// src/cli.ts
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", short: "c", default: "silo.toml" },
    force: { type: "boolean", short: "f", default: false },
    help: { type: "boolean", short: "h", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    "delete-cluster": { type: "boolean", default: false },
    clean: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});

const [command, ...args] = positionals;

switch (command) {
  case "init":
    await import("./commands/init").then((m) => m.init(values));
    break;
  case "up":
    await import("./commands/up").then((m) => m.up(args[0], values));
    break;
  case "down":
    await import("./commands/down").then((m) => m.down(values));
    break;
  case "status":
    await import("./commands/status").then((m) => m.status(values));
    break;
  case "env":
    await import("./commands/env").then((m) => m.env(args[0], values));
    break;
  default:
    printHelp();
}
```

### Port Check with Bun

```typescript
// src/core/ports.ts
// Check both wildcard and loopback — a port bound only on 127.0.0.1
// (e.g. Tilt) would appear free on 0.0.0.0 alone.
const PORT_CHECK_HOSTNAMES = ["0.0.0.0", "127.0.0.1"] as const;

async function tryBind(hostname: string, port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname,
      port,
      socket: {
        data() {},
      },
    });
    server.stop();
    return true;
  } catch {
    return false;
  }
}

async function isPortFree(port: number): Promise<boolean> {
  for (const hostname of PORT_CHECK_HOSTNAMES) {
    if (!(await tryBind(hostname, port))) {
      return false;
    }
  }
  return true;
}
```

### Process Spawning Pattern

```typescript
// src/backends/tilt.ts
import { $ } from "bun";

async function startTilt(envFile: string): Promise<Bun.Subprocess> {
  // Source env and run tilt
  const proc = Bun.spawn(["tilt", "up"], {
    cwd: process.cwd(),
    env: { ...process.env, ...loadEnvFile(envFile) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc;
}

// For hooks, use shell API
async function runHook(
  script: string,
  env: Record<string, string>
): Promise<void> {
  const result = await $`${script}`.env(env).quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Hook failed: ${script}`);
  }
}
```

## References

- Prior art: `~/dotfiles/claude-code/.claude/skills/gen-env/`
- Bun docs: https://bun.sh/docs
- Tilt: https://tilt.dev
- k3d: https://k3d.io
- Browser localhost subdomain behavior: Built into Chromium
