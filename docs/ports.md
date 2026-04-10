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

## Multi-Instance Isolation

silo maintains a machine-wide registry of live instances at
`~/.silo/instances/` (one JSON file per project, keyed on a hash of the
absolute project root). Each file records the instance name and the ports
currently allocated to it.

Before allocating, silo reads the registry and excludes every port owned by a
peer instance:

- Configured default ports already owned by a peer fall through to the
  ephemeral range.
- Lockfile-restored ports already owned by a peer also fall through.
- The ephemeral scan skips all excluded ports and wraps around the range if
  needed.

After allocating, silo writes its own registry entry with the final port
assignments. This guarantees that two silo instances on the same machine —
even two cold-start worktrees of the same project — get **disjoint** port sets,
not just probabilistically disjoint.

### Liveness

A registry entry is considered live as long as the project's `.silo.lock`
file exists. On every registry read, entries whose `.silo.lock` is gone (or
whose JSON is corrupt) are garbage-collected. `silo down --clean` removes both
the lockfile and the registry entry, releasing the ports for other instances.

### Override location

Set `SILO_PORT_REGISTRY_DIR` to relocate the registry directory (primarily for
tests).

## Availability Check

silo checks whether a port is free by attempting to bind to `0.0.0.0` with a
100ms timeout. This keeps checks fast and CI-friendly.

## Force Behavior

`--force` ignores the lockfile's stored ports and allocates fresh values using
the normal default-first strategy. Peer instances' ports (from the registry)
are still excluded, so `--force` cannot steal ports from another live silo
instance on the machine.

## k3d Registry Port

When `k3d.registry.enabled = true`, you must define `K3D_REGISTRY_PORT` in
`[ports]` so silo can create the registry and advertise it to the cluster.
