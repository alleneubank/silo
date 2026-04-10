# Port Allocation

This document describes how silo allocates ports. It is bundled with the CLI
and can be printed with:

```
silo doc ports
```

## Requirements

- `ports` must define at least one entry.
- Port values must be integers between 1 and 65535, or `random`/`0` to always
  allocate from the ephemeral range.

## Allocation Strategy

Ports are allocated in declaration order. For each port key:

1. If a lockfile exists and that port is free, reuse it (unless `--force`).
2. If the configured value is `random`/`0`, skip defaults and allocate from the
   ephemeral range (49152-65535).
3. Otherwise, try the configured default. If occupied, allocate the next free
   port from the ephemeral range (49152-65535).

Ports are unique per instance. If two keys share the same default value, the
first one wins and the next one will fall back to an ephemeral port.

## Ephemeral Seeding (Multi-Instance Isolation)

When silo needs to allocate from the ephemeral range, the scan does not always
start at 49152. Instead, the instance name is hashed into a 64-port slot and
the scan begins at that slot boundary, wrapping around to 49152 after it hits
65535.

This gives two silo instances with different names — e.g. two worktrees of the
same project — disjoint port windows even on a cold machine where nothing is
currently bound. The free-port probe still runs, so if two names happen to
hash to nearby slots the allocator falls through to the next free port
normally.

Allocation is deterministic: re-running `silo up` or `silo env` without a
lockfile on a machine with nothing bound produces the same ports for the same
instance name.

## Availability Check

silo checks whether a port is free by attempting to bind to `0.0.0.0` with a
100ms timeout. This keeps checks fast and CI-friendly.

## Force Behavior

`--force` ignores the lockfile's stored ports and allocates fresh values using
the normal default-first strategy. Since fresh ephemeral allocation is seeded
from the instance name hash, an instance's ports may shift from their
previously stored values when `--force` is used.

## k3d Registry Port

When `k3d.registry.enabled = true`, you must define `K3D_REGISTRY_PORT` in
`[ports]` so silo can create the registry and advertise it to the cluster.
