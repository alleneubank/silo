# Deterministic Port Allocation for Multi-Worktree Isolation

Tracking: [0xsend/silo#1](https://github.com/0xsend/silo/issues/1)
Date: 2026-04-10
Status: Proposed (rev 2)

## Revision history

- **rev 1** — hash-seeded slotted ephemeral scan. Rejected in review: on
  a cold machine, two names can hash to the same slot and produce
  identical port sets because the free-port probe has nothing to detect
  (reproduced with `wt-8` / `wt-20`). Birthday collisions are fundamental
  to any slot-based approach.
- **rev 2** — this document. Machine-wide port registry as the
  correctness layer.

## Problem

Two silo instances on the same machine that allocate ports back-to-back
get overlapping port sets because `allocatePorts` uses live free-port
detection only. The ephemeral scan always begins at
`EPHEMERAL_PORT_START` (49152), so the second instance picks the same
first-free port the first instance picked a moment earlier — they don't
actually collide until someone binds.

Reproduction (from the `sendapp-multi-worktree-poc`):

```
wt-a: NEXTJS_PORT=49152  ANVIL_MAINNET_PORT=49160  TEMPORAL_PORT=49166  ...
wt-b: NEXTJS_PORT=49152  SUPABASE_API_PORT=49160  SUPABASE_STUDIO_PORT=49166 ...
```

Runtime impact: the second instance's Tilt/next/temporal processes hit
`EADDRINUSE` as soon as the first instance starts binding.

## Goals

1. Two silo instances with different names get disjoint ephemeral port
   ranges on a cold machine (nothing bound), **guaranteed, not
   probabilistic**.
2. Behaviour for configured default ports and lockfile reuse is
   unchanged except that peer instances' ports are excluded.
3. `silo env`-only users (no long-lived parent process) are supported;
   liveness cannot depend on tracking a running pid.
4. Existing tests pass. No regression on the loopback detection fix
   shipped in 0.5.8.

## Non-Goals

- Cross-machine coordination.
- Atomic protection against concurrent `silo up` races between two
  different projects running within milliseconds of each other (noted
  under Limitations).
- Guaranteed no-collision with arbitrary user-picked default ports
  across instances (defaults still fall back to ephemeral when a peer
  already owns the default, but the allocator can't prevent two users
  from typing the same default before either has allocated).

## Design

### Machine-wide instance registry

silo maintains a directory of JSON files, one per live silo instance on
the machine:

```
~/.silo/instances/<fnv1a32-of-abs-project-root>.json
```

Each file:

```json
{
  "projectRoot": "/abs/path/to/project",
  "name": "wt-a",
  "ports": [49152, 49153, 49154],
  "createdAt": "2026-04-10T..."
}
```

One file per project (keyed on a hash of the absolute project root), not
per run. Writing is idempotent: re-running `silo up` or `silo env`
overwrites the same file with the current port assignments.

### Liveness: lockfile presence

An entry is considered **live** iff a `.silo.lock` file exists at its
`projectRoot`. This anchors liveness to silo's own lockfile lifecycle:

- Written by every `silo up` / `silo env` run.
- Removed by `silo down --clean`.
- Always present for the duration that the project has an "active"
  silo instance, regardless of whether a long-lived parent process is
  running.

This avoids the problems with pid-based liveness (`silo env`-only users
have no parent to track; pids get recycled).

On every registry read, stale entries (those whose lockfile no longer
exists) are deleted as a side effect. Corrupt entries that fail schema
validation are likewise removed.

### Allocation flow

Before `buildInstanceState`, `prepareTiltEnvironment` reads the registry
and computes `excludedPorts`: the union of all ports owned by peer
instances. `allocatePorts` treats `excludedPorts` as reserved:

- Configured default ports that are excluded fall through to ephemeral.
- Lockfile-restored ports that are excluded fall through to ephemeral.
- Ephemeral scan skips excluded ports and the already-allocated set.

After `buildInstanceState` completes and writes the lockfile, the
instance registers itself in the registry with its final port
assignments. Subsequent silo runs on the machine will see these ports
and avoid them.

### Ephemeral scan wrap-around

`findEphemeralPort` now wraps from `EPHEMERAL_PORT_END` back to
`EPHEMERAL_PORT_START` after exhausting the tail, so excluding a large
contiguous block at the tail of the range still finds a free port
anywhere else in the range rather than hitting `PORTS_EXHAUSTED`
prematurely.

### `silo down --clean`

On `--clean`, the lockfile is removed and the registry entry is
explicitly `unregisterInstance`d. Without `--clean`, the lockfile stays
and so does the registry entry, preserving the ports for the next
`silo up` in the same project.

## Data flow

```
prepareTiltEnvironment
    ├── readPeerPorts(projectRoot)
    │       └── list ~/.silo/instances/*.json
    │           ├── skip ours (same key or same resolved path)
    │           ├── GC entries whose .silo.lock is missing
    │           └── collect port arrays into Set<number>
    ├── buildInstanceState({ ..., excludedPorts })
    │       └── allocatePorts({ ..., excludedPorts })
    │              └── findEphemeralPort: skip (used ∪ excluded)
    └── registerInstance({ projectRoot, name, ports })
            └── write ~/.silo/instances/<key>.json
```

## Testing

`src/core/port_registry.test.ts` (new):

- **Missing registry dir** → `readPeerPorts` returns empty set.
- **Roundtrip**: register, read peer ports from different project,
  unregister, verify gone.
- **Self-exclusion**: peer read from the same project returns empty.
- **Aggregation**: two registered projects produce the union.
- **Stale GC**: deleting the project's lockfile removes the registry
  entry on next read.
- **Corrupt GC**: invalid JSON files are removed on next read.
- **Overwrite**: re-registering the same project replaces prior ports.

`src/core/ports.test.ts` (updated):

- **excludedPorts skipped** during ephemeral scan.
- **excludedPorts force default to ephemeral** fallback.
- **excludedPorts force lockfile port to ephemeral** fallback.
- **Wrap-around**: excluding all but `EPHEMERAL_PORT_END` returns the
  last port.
- Existing tests (lockfile reuse, default fallback, loopback
  integration) continue to pass.

## Alternatives considered

### Hash-seeded slots (rejected, rev 1)

Previous revision. Birthday collisions within 256 slots mean two
different names can hash to the same starting port, producing identical
sequences on a cold machine. The free-port probe catches nothing when
nothing is bound. Fundamentally probabilistic; cannot meet Goal #1.

### PID-tracked registry

Use `process.kill(pid, 0)` for liveness. Rejected: `silo env`-only users
have no long-lived process, and pids get recycled by the OS.

### Random per-run start

Pick a random `startAt` each invocation. Fixes collisions probabilistically
but makes results non-reproducible — bad for debugging and for the "run
gen-env twice, get the same ports" expectation.

## Limitations

- **Concurrent startup race**: if two silo instances from different
  projects call `readPeerPorts` at the same instant, they'll both see an
  empty registry (modulo each other) and could allocate overlapping
  ports before either writes its entry. In practice this is
  vanishingly rare (sub-millisecond window) and manifests as a
  subsequent `EADDRINUSE` which the user will notice. A file-locked
  read-modify-write cycle could eliminate this; deferred as a follow-up
  because it adds cross-platform complexity for an unlikely case.

- **Liveness is lockfile-presence, not binding**: if a user manually
  deletes a project's `.silo.lock` without running `silo down --clean`,
  the next peer read GCs their registry entry and frees those ports —
  even if they're still bound by a stale process. This is the same
  failure mode as today (the lockfile is authoritative for silo's view
  of what's running).

- **Same default port in multiple projects**: if two projects
  statically configure the same default port (e.g. `WEB_PORT = 3000`)
  and start at nearly the same time, the first to write its registry
  entry wins the default; the second falls back to ephemeral. Correct
  behaviour but may surprise users expecting the literal default.

## Migration / compatibility

- No config changes. No `.silo.lock` format changes.
- New on-disk state: `~/.silo/instances/` directory. Created on first
  allocation, GC'd per-entry on every read.
- Existing instances with a `.silo.lock` are unaware of the registry
  until the next `silo up` / `silo env`. On that next run, they'll be
  registered. No manual migration needed.
- `SILO_PORT_REGISTRY_DIR` environment variable overrides the default
  location (primarily for tests).

## Open questions

None.
